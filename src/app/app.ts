import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LatexRendererComponent } from './components/latex-renderer/latex-renderer.component';
import { MathQuillInputComponent } from './components/mathquill-input/mathquill-input.component';
import {
  Cell,
  CellSerializer,
  CodeCell,
  EngineeringParameter,
  EquationCell,
  NoteCell,
  Plugin,
  Project,
  Variable,
  Workspace,
  WORKSPACE_FORMAT,
  createEngineeringParameter
} from './models';
import { PythonExecutorService } from './services/python-executor.service';

interface DisplayVariable {
  name: string;
  value: string;
  unit: string;
  type: string;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, MathQuillInputComponent, LatexRendererComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  private readonly autosaveKey = 'alpha-solve.workspace.autosave.v5';

  protected readonly workspace = signal(this.loadWorkspace());
  protected readonly revision = signal(0);
  protected readonly activeSystem = computed(() => {
    this.revision();
    return this.workspace().activeSystem;
  });
  protected readonly selectedCellId = signal<string | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isRunning = signal(false);
  protected readonly statusMessage = signal('Initializing Python runtime…');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly pluginCount = signal(0);

  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private lastState = this.workspace().toString();
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly pythonExecutor: PythonExecutorService) {
    void this.initializeRuntime();
  }

  protected selectSystem(systemId: string): void {
    this.workspace().activeSystemId = systemId;
    this.selectedCellId.set(null);
    this.touch(false);
  }

  protected selectCell(cell: Cell): void {
    this.selectedCellId.set(cell.id);
  }

  protected addSystem(): void {
    const system = new Project(`System ${this.workspace().systems.length + 1}`);
    system.description = 'Describe the engineering system and its assumptions.';
    system.parameters = [createEngineeringParameter('x', '0', '', 'Initial input')];
    system.addCell(CellSerializer.createEquationCell(''));
    this.workspace().systems.push(system);
    this.workspace().activeSystemId = system.id;
    this.recordChange('System created');
  }

  protected deleteSystem(system: Project, event: MouseEvent): void {
    event.stopPropagation();
    if (this.workspace().systems.length === 1) {
      this.showMessage('A workspace must contain at least one system.');
      return;
    }
    const index = this.workspace().systems.indexOf(system);
    this.workspace().systems.splice(index, 1);
    if (this.workspace().activeSystemId === system.id) {
      this.workspace().activeSystemId = this.workspace().systems[Math.max(0, index - 1)].id;
    }
    this.recordChange('System removed');
  }

  protected addCell(type: 'equation' | 'note' | 'code'): void {
    const system = this.activeSystem();
    if (!system) return;

    const cell = type === 'equation'
      ? CellSerializer.createEquationCell('')
      : type === 'note'
        ? CellSerializer.createNoteCell('')
        : CellSerializer.createCodeCell(
          'def calculate(m, k, c):\n' +
          '    omega_n = (k / m) ** 0.5\n' +
          '    zeta = c / (2 * (k * m) ** 0.5)\n' +
          '    return {"omega_n": omega_n, "zeta": zeta}'
        );

    system.addCell(cell);
    this.selectedCellId.set(cell.id);
    this.markFromCellStale(cell.id);
    this.recordChange(`${this.cellLabel(cell)} added`);
  }

  protected deleteCell(cell: Cell): void {
    const system = this.activeSystem();
    if (!system) return;
    const index = system.cells.indexOf(cell);
    if (index < 0) return;
    system.cells.splice(index, 1);
    this.selectedCellId.set(null);
    const nextCell = system.cells[Math.min(index, system.cells.length - 1)];
    if (nextCell) this.markFromCellStale(nextCell.id);
    this.recordChange(`${this.cellLabel(cell)} removed`);
  }

  protected moveCell(cell: Cell, direction: -1 | 1): void {
    const system = this.activeSystem();
    if (!system) return;
    const index = system.cells.indexOf(cell);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= system.cells.length) return;
    system.cells.splice(index, 1);
    system.cells.splice(target, 0, cell);
    this.markFromCellStale(system.cells[Math.min(index, target)].id);
    this.recordChange('Calculation order changed');
  }

  protected equationChanged(cell: EquationCell, latex: string): void {
    cell.latex = latex;
    cell.solutions = [];
    cell.updatedAt = new Date();
    this.markFromCellStale(cell.id);
    this.recordChange();
  }

  protected noteChanged(cell: NoteCell, content: string): void {
    cell.content = content;
    cell.updatedAt = new Date();
    this.recordChange();
  }

  protected codeChanged(cell: CodeCell, source: string): void {
    cell.source = source;
    cell.status = 'stale';
    cell.error = undefined;
    cell.updatedAt = new Date();
    this.markFromCellStale(cell.id);
    this.recordChange();
  }

  protected outputUnitChanged(cell: CodeCell): void {
    cell.updatedAt = new Date();
    this.recordChange();
  }

  protected parameterChanged(): void {
    const system = this.activeSystem();
    if (!system) return;
    system.updatedAt = new Date();
    const firstCell = system.cells[0];
    if (firstCell) this.markFromCellStale(firstCell.id);
    this.recordChange();
  }

  protected metadataChanged(): void {
    const system = this.activeSystem();
    if (system) system.updatedAt = new Date();
    this.recordChange();
  }

  protected addParameter(): void {
    const system = this.activeSystem();
    if (!system) return;
    let index = system.parameters.length + 1;
    let name = `parameter_${index}`;
    while (system.parameters.some(parameter => parameter.name === name)) {
      index++;
      name = `parameter_${index}`;
    }
    system.parameters.push(createEngineeringParameter(name, '0'));
    this.parameterChanged();
  }

  protected deleteParameter(parameter: EngineeringParameter): void {
    const system = this.activeSystem();
    if (!system) return;
    system.parameters = system.parameters.filter(item => item.id !== parameter.id);
    this.parameterChanged();
  }

  protected async runSystem(): Promise<void> {
    const system = this.activeSystem();
    if (!system || this.isRunning()) return;
    const firstExecutable = this.findFirstExecutable(system.cells);
    if (!firstExecutable) {
      this.showMessage('Add an equation or Python function before running.');
      return;
    }
    if (!this.pythonExecutor.isReady()) {
      this.showMessage('The Python runtime is still loading.');
      return;
    }

    this.isRunning.set(true);
    this.errorMessage.set(null);
    this.statusMessage.set(`Running ${system.name}…`);
    try {
      await system.updateContext(firstExecutable.id, this.pythonExecutor);
      this.recordChange();
      this.statusMessage.set(`Completed ${system.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage.set(message);
      this.statusMessage.set('Run failed');
    } finally {
      this.isRunning.set(false);
      this.touch(false);
    }
  }

  protected async runFromCell(cell: Cell): Promise<void> {
    const system = this.activeSystem();
    if (!system || this.isRunning() || (cell.type !== 'equation' && cell.type !== 'code')) return;
    if (!this.pythonExecutor.isReady()) {
      this.showMessage('The Python runtime is still loading.');
      return;
    }
    this.isRunning.set(true);
    this.statusMessage.set(`Running from ${this.cellLabel(cell)}…`);
    try {
      await system.updateContext(cell.id, this.pythonExecutor);
      this.recordChange();
      this.statusMessage.set('Run complete');
    } finally {
      this.isRunning.set(false);
      this.touch(false);
    }
  }

  protected newWorkspace(): void {
    this.workspace.set(this.createDemoWorkspace(false));
    this.resetHistory();
    this.touch(false);
    this.showMessage('New workspace created');
  }

  protected saveWorkspace(): void {
    this.downloadJson(`${this.safeFileName(this.workspace().name)}.asolve`, this.workspace().toString());
    this.showMessage('Workspace saved');
  }

  protected openWorkspace(): void {
    this.chooseJsonFile(async text => {
      const raw = JSON.parse(text) as { format?: string };
      if (raw.format === WORKSPACE_FORMAT) {
        this.workspace.set(Workspace.fromString(text));
      } else {
        const system = Project.fromString(text);
        this.workspace.set(new Workspace(system.name, [system], system.id));
      }
      this.resetHistory();
      this.touch(false);
      this.showMessage('Workspace opened');
    });
  }

  protected exportSystem(): void {
    const system = this.activeSystem();
    if (!system) return;
    this.downloadJson(`${this.safeFileName(system.name)}.system.json`, system.toString());
    this.showMessage('System JSON exported');
  }

  protected importSystem(): void {
    this.chooseJsonFile(async text => {
      const system = Project.fromString(text);
      if (this.workspace().systems.some(item => item.id === system.id)) {
        system.id = crypto.randomUUID();
      }
      this.workspace().systems.push(system);
      this.workspace().activeSystemId = system.id;
      this.recordChange('System JSON imported');
    });
  }

  protected undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.workspace().toString());
    this.workspace.set(Workspace.fromString(previous));
    this.lastState = previous;
    this.touch(false);
  }

  protected redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.workspace().toString());
    this.workspace.set(Workspace.fromString(next));
    this.lastState = next;
    this.touch(false);
  }

  protected canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  protected canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  protected equationCells(system: Project): EquationCell[] {
    return system.cells.filter((cell): cell is EquationCell => cell.type === 'equation');
  }

  protected codeCells(system: Project): CodeCell[] {
    return system.cells.filter((cell): cell is CodeCell => cell.type === 'code');
  }

  protected noteCells(system: Project): NoteCell[] {
    return system.cells.filter((cell): cell is NoteCell => cell.type === 'note');
  }

  protected asEquation(cell: Cell): EquationCell {
    return cell as EquationCell;
  }

  protected asCode(cell: Cell): CodeCell {
    return cell as CodeCell;
  }

  protected asNote(cell: Cell): NoteCell {
    return cell as NoteCell;
  }

  protected cellLabel(cell: Cell): string {
    if (cell.type === 'equation') return 'Equation';
    if (cell.type === 'code') return cell.title || 'Python function';
    if (cell.type === 'note') return 'Note';
    return cell.name || 'Folder';
  }

  protected computedVariables(): DisplayVariable[] {
    const system = this.activeSystem();
    if (!system) return [];
    const parameterNames = new Set(system.parameters.map(parameter => parameter.name));
    let variables: Variable[] = [];
    for (let index = system.cells.length - 1; index >= 0; index--) {
      const cell = system.cells[index];
      if ((cell.type === 'equation' || cell.type === 'code') && cell.context) {
        variables = cell.context.variables;
        break;
      }
    }
    const outputUnits = new Map<string, string>();
    for (const cell of system.cells) {
      if (cell.type === 'code') {
        for (const output of cell.outputs) outputUnits.set(output.name, output.unit || '');
      }
    }
    return variables
      .filter(variable => !parameterNames.has(variable.name))
      .map(variable => ({
        name: variable.name,
        value: variable.values.join(', '),
        unit: outputUnits.get(variable.name) || '',
        type: variable.type
      }));
  }

  protected cellIndex(cell: Cell): number {
    return this.activeSystem()?.cells.indexOf(cell) ?? -1;
  }

  private async initializeRuntime(): Promise<void> {
    this.isLoading.set(true);
    const plugins: Plugin[] = [];
    try {
      this.statusMessage.set('Loading analytical solver…');
      plugins.push(await Plugin.loadFromGit('https://github.com/icanthink42/alpha_solve_analytical.git'));
    } catch (error) {
      console.warn('The analytical plugin could not be loaded. Code cells remain available.', error);
    }

    try {
      this.statusMessage.set('Starting Python runtime…');
      await this.pythonExecutor.initialize(plugins);
      this.pluginCount.set(plugins.length);
      this.statusMessage.set(plugins.length > 0 ? 'Ready · analytical solver loaded' : 'Ready · code cells available');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage.set(message);
      this.statusMessage.set('Python runtime failed to initialize');
    } finally {
      this.isLoading.set(false);
    }
  }

  private loadWorkspace(): Workspace {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(this.autosaveKey);
      if (saved) {
        try {
          return Workspace.fromString(saved);
        } catch (error) {
          console.warn('Autosave could not be restored.', error);
        }
      }
    }
    return this.createDemoWorkspace(true);
  }

  private createDemoWorkspace(includeDemo: boolean): Workspace {
    const system = new Project(includeDemo ? 'Mass–Spring–Damper' : 'Untitled System');
    system.description = includeDemo
      ? 'Second-order mechanical system used to demonstrate scoped parameters, equations, and executable Python.'
      : 'Describe the engineering system and its assumptions.';
    system.parameters = includeDemo
      ? [
        createEngineeringParameter('m', '10', 'kg', 'Mass'),
        createEngineeringParameter('k', '120', 'N/m', 'Spring constant'),
        createEngineeringParameter('c', '20', 'N·s/m', 'Damping coefficient'),
        createEngineeringParameter('x_0', '0.5', 'm', 'Initial displacement'),
        createEngineeringParameter('v_0', '1.0', 'm/s', 'Initial velocity')
      ]
      : [createEngineeringParameter('x', '0', '', 'Initial input')];

    if (includeDemo) {
      system.addCell(CellSerializer.createNoteCell('Stored spring energy and derived dynamic properties'));
      system.addCell(CellSerializer.createEquationCell('U=0.5\\cdot k\\cdot x_0^2'));
      const codeCell = CellSerializer.createCodeCell(
        'def calculate(m, k, c):\n' +
        '    """Return the natural frequency and damping ratio."""\n' +
        '    omega_n = (k / m) ** 0.5\n' +
        '    zeta = c / (2 * (k * m) ** 0.5)\n' +
        '    return {"omega_n": omega_n, "zeta": zeta}'
      );
      codeCell.title = 'Dynamic properties';
      codeCell.outputs = [
        { name: 'omega_n', value: '', unit: 'rad/s' },
        { name: 'zeta', value: '', unit: '' }
      ];
      system.addCell(codeCell);
    } else {
      system.addCell(CellSerializer.createEquationCell(''));
    }

    return new Workspace(includeDemo ? 'Engineering Workspace' : 'Untitled Workspace', [system], system.id);
  }

  private findFirstExecutable(cells: Cell[]): Cell | null {
    for (const cell of cells) {
      if (cell.type === 'equation' || cell.type === 'code') return cell;
      if (cell.type === 'folder') {
        const nested = this.findFirstExecutable(cell.cells);
        if (nested) return nested;
      }
    }
    return null;
  }

  private markFromCellStale(cellId: string): void {
    const system = this.activeSystem();
    if (!system) return;
    const startIndex = system.cells.findIndex(cell => cell.id === cellId);
    if (startIndex < 0) return;
    for (let index = startIndex; index < system.cells.length; index++) {
      const cell = system.cells[index];
      if (cell.type === 'code' && cell.status !== 'running') cell.status = 'stale';
      if (cell.type === 'equation') cell.solutions = [];
    }
  }

  private recordChange(message?: string): void {
    const current = this.workspace().toString();
    if (current !== this.lastState) {
      this.undoStack.push(this.lastState);
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack.length = 0;
      this.lastState = current;
    }
    this.workspace().updatedAt = new Date();
    this.touch(true);
    if (message) this.showMessage(message);
  }

  private resetHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastState = this.workspace().toString();
  }

  private touch(scheduleAutosave: boolean): void {
    this.revision.update(value => value + 1);
    if (!scheduleAutosave || typeof localStorage === 'undefined') return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      localStorage.setItem(this.autosaveKey, this.workspace().toString());
      this.autosaveTimer = null;
    }, 350);
  }

  private chooseJsonFile(onLoad: (text: string) => Promise<void>): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.asolve,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        void onLoad(String(reader.result)).catch(error => {
          this.errorMessage.set(error instanceof Error ? error.message : String(error));
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  private downloadJson(fileName: string, json: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private safeFileName(value: string): string {
    return value.trim().replace(/[^a-z0-9-_]+/gi, '_') || 'alpha-solve';
  }

  private showMessage(message: string): void {
    this.statusMessage.set(message);
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.statusMessage.set(this.pythonExecutor.isReady() ? 'Ready' : 'Loading runtime…');
      this.messageTimer = null;
    }, 2400);
  }

  ngOnDestroy(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}
