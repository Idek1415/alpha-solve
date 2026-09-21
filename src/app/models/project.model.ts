import { Cell, SerializableCell, CellSerializer, EquationCell, CodeCell } from './cell.model';
import { PythonExecutorService } from '../services/python-executor.service';
import { Context, Variable, createCellFunctionInput } from './context.model';
import { MetaFunctionResult } from './meta-function-result.model';
import { CellFunctionResult } from './cell-function-result.model';
import { createProcMacroInput } from './proc-macro-input.model';
import { createDropdownSelection } from './dropdown.model';
import {
  EngineeringParameter,
  parametersToContext
} from './engineering-parameter.model';
import { inferEquationUnit } from './unit-system';

export const SYSTEM_FORMAT = 'alpha-solve/system';
export const SYSTEM_VERSION = 1;

/**
 * Main project class containing a list of cells
 */
export class Project {
  id: string;
  name: string;
  cells: Cell[];
  description: string;
  parameters: EngineeringParameter[];
  createdAt: Date;
  updatedAt: Date;
  lastSolvePasses = 0;

  constructor(
    name: string = 'Untitled Project',
    cells: Cell[] = [],
    id?: string,
    createdAt?: Date,
    updatedAt?: Date,
    description: string = '',
    parameters: EngineeringParameter[] = []
  ) {
    this.id = id || crypto.randomUUID();
    this.name = name;
    this.cells = cells;
    this.description = description;
    this.parameters = parameters;
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }

  /**
   * Add a cell to the project
   */
  addCell(cell: Cell): void {
    this.cells.push(cell);
    this.updatedAt = new Date();
  }

  /**
   * Remove a cell by ID
   */
  removeCell(cellId: string): boolean {
    const index = this.cells.findIndex((c) => c.id === cellId);
    if (index !== -1) {
      this.cells.splice(index, 1);
      this.updatedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Find a cell by ID (searches recursively in folders)
   */
  findCell(cellId: string): Cell | null {
    return this.findCellRecursive(this.cells, cellId);
  }

  private findCellRecursive(cells: Cell[], cellId: string): Cell | null {
    for (const cell of cells) {
      if (cell.id === cellId) {
        return cell;
      }
      if (cell.type === 'folder') {
        const found = this.findCellRecursive(cell.cells, cellId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Serialize the project to JSON-compatible object
   */
  toJSON(): SerializableProject {
    return {
      format: SYSTEM_FORMAT,
      version: SYSTEM_VERSION,
      id: this.id,
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      cells: this.cells.map((c) => CellSerializer.serialize(c)),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Serialize the project to a JSON string
   */
  toString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  /**
   * Create a Project instance from a JSON object
   */
  static fromJSON(data: SerializableProject): Project {
    if (data.format && data.format !== SYSTEM_FORMAT) {
      throw new Error(`Unsupported system format: ${data.format}`);
    }
    if (data.version && data.version > SYSTEM_VERSION) {
      throw new Error(`System version ${data.version} is newer than this application supports.`);
    }
    const cells = data.cells.map((c) => CellSerializer.deserialize(c));
    return new Project(
      data.name,
      cells,
      data.id,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.description || '',
      data.parameters || []
    );
  }

  /**
   * Create a Project instance from a JSON string
   */
  static fromString(json: string): Project {
    const data = JSON.parse(json) as SerializableProject | LlmAnalysisDocument;
    if (data.format === LLM_ANALYSIS_FORMAT) {
      if (!data.system || data.system.format !== SYSTEM_FORMAT) {
        throw new Error('The LLM analysis document does not contain a valid Alpha Solve system.');
      }
      return Project.fromJSON(data.system);
    }
    return Project.fromJSON(data as SerializableProject);
  }

  /**
   * Create a new empty project
   */
  static create(name: string = 'Untitled Project'): Project {
    return new Project(name);
  }

  /**
   * Clone the project (deep copy)
   */
  clone(): Project {
    return Project.fromJSON(this.toJSON());
  }

  /**
   * Re-evaluate the system until values stop changing. A bounded fixed-point
   * pass lets a cell consume a value produced by a later cell without making
   * cycles capable of running forever.
   */
  async updateContext(cellId: string, pythonExecutor: PythonExecutorService): Promise<void> {
    const executable = this.flattenExecutableCells(this.cells);
    const startIndex = executable.findIndex(cell => cell.id === cellId);
    if (startIndex < 0) return;

    const ordered = [...executable.slice(startIndex), ...executable.slice(0, startIndex)];
    const inputs = parametersToContext(this.parameters);
    const inputNames = new Set(inputs.variables.map(variable => variable.name));
    let known = inputs;
    let previousSignature = this.contextSignature(known);
    const seen = new Set([previousSignature]);
    const maxPasses = Math.min(20, Math.max(3, executable.length * 2));
    this.lastSolvePasses = 0;

    for (let pass = 1; pass <= maxPasses; pass++) {
      let passContext = known;
      for (const cell of ordered) {
        const result = cell.type === 'equation'
          ? await this.updateCellContext(cell, passContext, pythonExecutor)
          : await this.updateCodeCellContext(cell, passContext, pythonExecutor);
        passContext = this.mergeContexts(passContext, result, inputs, inputNames);
      }

      known = passContext;
      this.lastSolvePasses = pass;
      const signature = this.contextSignature(known);
      if (signature === previousSignature || seen.has(signature)) break;
      seen.add(signature);
      previousSignature = signature;
    }

    for (const cell of executable) cell.context = this.cloneContext(known);
    this.updatedAt = new Date();
  }

  private flattenExecutableCells(cells: Cell[]): (EquationCell | CodeCell)[] {
    const result: (EquationCell | CodeCell)[] = [];
    for (const cell of cells) {
      if (cell.type === 'equation' || cell.type === 'code') result.push(cell);
      if (cell.type === 'folder') result.push(...this.flattenExecutableCells(cell.cells));
    }
    return result;
  }

  private mergeContexts(current: Context, update: Context, inputs: Context, inputNames: Set<string>): Context {
    const variables = new Map<string, Variable>();
    for (const variable of current.variables) {
      variables.set(variable.name, new Variable(variable.name, variable.type, [...variable.values], variable.unit));
    }
    for (const variable of update.variables) {
      if (!inputNames.has(variable.name)) {
        variables.set(variable.name, new Variable(variable.name, variable.type, [...variable.values], variable.unit));
      }
    }
    for (const variable of inputs.variables) {
      variables.set(variable.name, new Variable(variable.name, variable.type, [...variable.values], variable.unit));
    }
    return { variables: [...variables.values()] };
  }

  private contextSignature(context: Context): string {
    return JSON.stringify([...context.variables]
      .map(variable => [variable.name, variable.type, [...variable.values]])
      .sort(([left], [right]) => String(left).localeCompare(String(right))));
  }

  private cloneContext(context: Context): Context {
    return {
      variables: context.variables.map(variable =>
        new Variable(variable.name, variable.type, [...variable.values], variable.unit))
    };
  }

  private async updateCodeCellContext(
    cell: CodeCell,
    inputContext: Context,
    pythonExecutor: PythonExecutorService
  ): Promise<Context> {
    const startedAt = performance.now();
    cell.status = 'running';
    cell.error = undefined;

    try {
      const previousUnits = new Map(cell.outputs.map(output => [output.name, output.unit]));
      const result = await pythonExecutor.executeCodeCell(cell.source, inputContext);
      cell.functionName = result.functionName;
      cell.outputs = result.outputs.map(output => ({
        ...output,
        unit: previousUnits.get(output.name) || output.unit || ''
      }));
      const outputUnits = new Map(cell.outputs.map(output => [output.name, output.unit || '']));
      for (const variable of result.context.variables) {
        variable.unit = variable.unit || outputUnits.get(variable.name) || inputContext.variables.find(input => input.name === variable.name)?.unit || '';
      }
      cell.stdout = result.stdout;
      cell.context = result.context;
      cell.status = 'success';
      cell.executionTimeMs = performance.now() - startedAt;
      cell.updatedAt = new Date();
      return result.context;
    } catch (error) {
      cell.status = 'error';
      cell.error = error instanceof Error ? error.message : String(error);
      cell.stdout = '';
      cell.context = inputContext;
      cell.executionTimeMs = performance.now() - startedAt;
      cell.updatedAt = new Date();
      return inputContext;
    }
  }

  /**
   * Run proc macros on a cell to potentially modify its content
   * Returns a modified copy of the cell if any proc macro modifies it, otherwise returns the original cell
   * Runs all applicable macros sequentially in priority order
   */
  private async runProcMacros(cell: EquationCell, inputContext: Context, pythonExecutor: PythonExecutorService): Promise<EquationCell> {
    // Get all available proc macros
    const availableMacros = pythonExecutor.getAvailableProcMacros();

    if (availableMacros.length === 0) {
      return cell;
    }

    // Start with the original cell's LaTeX
    let currentLatex = cell.latex;
    let wasModified = false;

    // Call meta function for each available proc macro to determine which ones want to run
    const metaResults: { result: MetaFunctionResult; functionName: string }[] = [];

    for (const macro of availableMacros) {
      try {
        const input = createProcMacroInput(currentLatex, inputContext);
        const execResult = await pythonExecutor.callProcMacroMetaFunction(macro.functionName, input);

        if (execResult.result) {
          metaResults.push({
            result: execResult.result as MetaFunctionResult,
            functionName: macro.functionName
          });
        }
      } catch (error) {
        console.warn(`Failed to call proc macro meta function for ${macro.functionName}:`, error);
      }
    }

    if (metaResults.length === 0) {
      return cell;
    }

    // Filter out macros that returned use_result=False
    const usableResults = metaResults.filter(mr => mr.result.useResult);

    if (usableResults.length === 0) {
      return cell;
    }

    // Sort by index (lowest index = highest priority, runs first)
    usableResults.sort((a, b) => a.result.index - b.result.index);

    // Run each proc macro sequentially, applying each transformation on top of the previous one
    for (const macroInfo of usableResults) {
      try {
        const input = createProcMacroInput(currentLatex, inputContext);
        const execResult = await pythonExecutor.callProcMacro(macroInfo.functionName, input);

        if (execResult.result) {
          const macroResult = execResult.result as any; // ProcMacroResult type

          // If the proc macro modified the LaTeX, update currentLatex
          if (macroResult.modifiedLatex && macroResult.modifiedLatex !== currentLatex) {
            console.log(`[runProcMacros] ${macroInfo.functionName}: ${currentLatex} -> ${macroResult.modifiedLatex}`);
            currentLatex = macroResult.modifiedLatex;
            wasModified = true;
          }
        }
      } catch (error) {
        console.error(`Failed to execute proc macro ${macroInfo.functionName}:`, error);
      }
    }

    // If any macro modified the LaTeX, return a modified copy of the cell
    if (wasModified) {
      const modifiedCell = { ...cell };
      modifiedCell.latex = currentLatex;
      return modifiedCell;
    }

    return cell;
  }

  /**
   * Update context for a single equation cell
   * Returns the new context after processing this cell
   */
  private async updateCellContext(cell: EquationCell, inputContext: Context, pythonExecutor: PythonExecutorService): Promise<Context> {
    // Step 1: Run proc macros to potentially modify cell content
    const modifiedCell = await this.runProcMacros(cell, inputContext, pythonExecutor);

    // Step 2: Run cell solution functions on the potentially modified cell
    // Get all available functions
    const availableFunctions = pythonExecutor.getAvailableFunctions();

    if (availableFunctions.length === 0) {
      return inputContext;
    }

    // Call meta function for each available function
    const metaResults: { result: MetaFunctionResult; functionName: string }[] = [];

    for (const func of availableFunctions) {
      try {
        const input = createCellFunctionInput(modifiedCell, inputContext);
        const execResult = await pythonExecutor.callMetaFunction(func.functionName, input);

        if (execResult.result) {
          metaResults.push({
            result: execResult.result as MetaFunctionResult,
            functionName: func.functionName
          });
        }
      } catch (error) {
        console.warn(`Failed to call meta function for ${func.functionName}:`, error);
      }
    }

    if (metaResults.length === 0) {
      // No meta functions available, propagate context and clear solutions/dropdowns
      cell.context = inputContext;
      cell.solutions = [];
      cell.dropdowns = undefined;
      cell.dropdownSelections = undefined;
      cell.updatedAt = new Date();
      return inputContext;
    }

    // Filter out functions that returned use_result=False
    const usableResults = metaResults.filter(mr => mr.result.useResult);

    if (usableResults.length === 0) {
      // No functions want to be used, propagate context and clear solutions/dropdowns
      cell.context = inputContext;
      cell.solutions = [];
      cell.dropdowns = undefined;
      cell.dropdownSelections = undefined;
      cell.updatedAt = new Date();
      return inputContext;
    }

    // Sort by index and choose the top one (lowest index)
    usableResults.sort((a, b) => a.result.index - b.result.index);
    const selectedFunction = usableResults[0];

    // Store dropdowns from the selected meta function result
    if (selectedFunction.result.dropdowns && selectedFunction.result.dropdowns.length > 0) {
      cell.dropdowns = selectedFunction.result.dropdowns;

      // Initialize dropdown selections if not already set
      if (!cell.dropdownSelections || cell.dropdownSelections.length === 0) {
        cell.dropdownSelections = selectedFunction.result.dropdowns.map(d => createDropdownSelection(d));
      } else {
        // Update dropdown selections to match current dropdowns
        // Keep existing selections where possible, add new ones for new dropdowns
        const newSelections = selectedFunction.result.dropdowns.map(dropdown => {
          const existing = cell.dropdownSelections?.find(s => s.title === dropdown.title);
          if (existing && dropdown.items.includes(existing.selectedItem)) {
            return existing;
          }
          return createDropdownSelection(dropdown);
        });
        cell.dropdownSelections = newSelections;
      }
    } else {
      // No dropdowns from meta function, clear them
      cell.dropdowns = undefined;
      cell.dropdownSelections = undefined;
    }

    // Run the selected function to get new context (using the potentially modified cell)
    try {
      const input = createCellFunctionInput(modifiedCell, inputContext);
      const execResult = await pythonExecutor.callFunction(selectedFunction.functionName, input);

      if (execResult.result) {
        const cellResult = execResult.result as CellFunctionResult;

        // Update cell context if new context is provided
        let newContext = inputContext;
        if (cellResult.newContext) {
          const knownUnits = new Map(inputContext.variables.map(variable => [variable.name, variable.unit || '']));
          for (const variable of cellResult.newContext.variables) {
            if (!variable.unit) variable.unit = inferEquationUnit(modifiedCell.latex, variable.name, knownUnits);
          }
          cell.context = cellResult.newContext;
          newContext = cellResult.newContext;
        } else {
          cell.context = inputContext;
        }

        // Update visible solutions if provided
        if (cellResult.visibleSolutions) {
          const isOnlyConfirmation = cellResult.visibleSolutions.length > 0 &&
            cellResult.visibleSolutions.every(solution => /^(?:\$\$)?\s*(?:True|False)\s*(?:\$\$)?$/i.test(solution));
          if (!isOnlyConfirmation || !cell.solutions?.length) {
            cell.solutions = cellResult.visibleSolutions;
          }
        }

        cell.updatedAt = new Date();
        return newContext;
      }
    } catch (error) {
      console.error(`Failed to execute function ${selectedFunction.functionName}:`, error);
    }

    return inputContext;
  }

  /**
   * Find a cell and return it with its parent array and index
   */
  private findCellWithParent(
    cells: Cell[],
    cellId: string
  ): { cell: Cell; parentArray: Cell[]; index: number } | null {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];

      if (cell.id === cellId) {
        return { cell, parentArray: cells, index: i };
      }

      if (cell.type === 'folder') {
        const found = this.findCellWithParent(cell.cells, cellId);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }
}

/**
 * Serializable representation of a project
 */
export interface SerializableProject {
  format?: typeof SYSTEM_FORMAT;
  version?: number;
  id: string;
  name: string;
  description?: string;
  parameters?: EngineeringParameter[];
  cells: SerializableCell[];
  createdAt: string;
  updatedAt: string;
}

export const LLM_ANALYSIS_FORMAT = 'alpha-solve/llm-analysis';

export interface LlmAnalysisDocument {
  format: typeof LLM_ANALYSIS_FORMAT;
  version: number;
  system: SerializableProject;
  [key: string]: unknown;
}
