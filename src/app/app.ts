import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, computed, signal } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
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
import { cellProducesVariable, cellUsesVariable, codeIdentifiers, equationIdentifiers } from './models/variable-references';

interface DisplayVariable {
  name: string;
  value: string;
  unit: string;
  type: string;
}

interface ContextAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuState {
  title: string;
  x: number;
  y: number;
  actions: ContextAction[];
}

interface VariableReferences {
  name: string;
  kind: 'input' | 'computed';
  producers: Cell[];
  usages: Cell[];
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, MathQuillInputComponent, LatexRendererComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css', './context-menu.css']
})
export class App implements OnDestroy {
  private readonly autosaveKey = 'alpha-solve.workspace.autosave.v5';

  protected readonly workspace = signal(this.loadWorkspace());
  protected readonly projects = signal<Workspace[]>(this.loadProjects());
  protected readonly helpOpen = signal(false);
  protected readonly contextMenu = signal<ContextMenuState | null>(null);
  protected readonly variableReferences = signal<VariableReferences | null>(null);
  protected readonly helpSection = signal('Getting started');
  protected readonly collapsed = signal<Set<string>>(new Set());
  protected readonly savedPath = signal('');
  protected readonly lightTheme = signal(typeof localStorage !== 'undefined' && localStorage.getItem('alpha-solve.theme') === 'light');
  protected readonly helpSections = ['Getting started', 'Projects and files', 'Equations and variables', 'Python functions', 'Solver capabilities', 'Arrange calculations', 'JSON and LLMs', 'About'];
  protected readonly solverCapabilities = [
    'Algebraic equations with one or more symbolic variables',
    'Numerical substitution and expression evaluation',
    'Simplification of symbolic expressions',
    'Powers, roots, fractions, logarithms, exponentials, and trigonometric functions',
    'Definite and indefinite integrals supported by the active SymPy solver',
    'Ordinary differential equations supported by the active SymPy solver',
    'Custom single-function Python calculations returning named variables',
    'Multi-pass dependencies between equations and Python calculations',
    'Simultaneous solving of connected algebraic equations',
    'Numerical solving with initial guesses and optional bounds when symbolic solving fails'
  ];
  private draggedCell: string | null = null;

  private loadProjects(): Workspace[] {
    try {
      const data = localStorage.getItem('alpha-solve.projects.v1');
      if (data) {
        const projects = (JSON.parse(data) as string[]).map(value => Workspace.fromString(value));
        if (projects.length) {
          this.workspace.set(projects.find(p => p.id === this.workspace().id) || projects[0]);
          return projects;
        }
      }
    } catch { /* Recover the existing single-workspace autosave. */ }
    return [this.workspace()];
  }

  protected activateProject(project: Workspace): void {
    this.syncProjects();
    this.collapsed.update(current => {
      const next = new Set(current);
      next.add(this.workspace().id);
      next.delete(project.id);
      return next;
    });
    this.workspace.set(project);
    this.selectedCellId.set(null);
    this.resetHistory();
    this.touch(true);
  }

  private syncProjects(): void {
    this.projects.update(projects => projects.map(p => p.id === this.workspace().id ? this.workspace() : p));
  }

  protected toggleCollapsed(id: string): void {
    this.collapsed.update(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected showHelp(): void {
    this.helpOpen.set(true);
    setTimeout(() => document.querySelector<HTMLButtonElement>('.help-dialog button')?.focus());
  }

  @HostListener('document:keydown', ['$event'])
  protected helpKeyboard(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.contextMenu()) {
      this.contextMenu.set(null);
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && this.variableReferences()) {
      this.variableReferences.set(null);
      event.preventDefault();
      return;
    }
    if (!this.helpOpen()) return;
    if (event.key === 'Escape') {
      this.helpOpen.set(false);
      document.querySelector<HTMLButtonElement>('.help-button')?.focus();
      event.preventDefault();
    }
    if (event.key === 'Tab') {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.help-dialog button'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  @HostListener('document:click')
  protected dismissContextMenu(): void {
    this.contextMenu.set(null);
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.contextMenu.set(null);
  }

  protected revealCell(cell: Cell): void {
    this.selectCell(cell);
    if (this.collapsed().has(cell.id)) this.toggleCollapsed(cell.id);
    setTimeout(() => document.getElementById(`cell-${cell.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  private showContextMenu(event: MouseEvent, title: string, actions: ContextAction[]): void {
    event.preventDefault();
    event.stopPropagation();
    const width = 228;
    const height = 35 + actions.length * 34;
    this.contextMenu.set({
      title,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      actions
    });
    setTimeout(() => document.querySelector<HTMLButtonElement>('.context-menu button')?.focus());
  }

  protected activateContextAction(action: ContextAction): void {
    this.contextMenu.set(null);
    if (!action.disabled) action.run();
  }

  protected workspaceContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button, input, textarea, .calculation-card, .mathquill-input')) return;
    const cards = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.calculation-card'));
    const index = cards.findIndex(card => event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2);
    const insertAt = index < 0 ? cards.length : index;
    this.showContextMenu(event, 'Add calculation here', [
      { label: 'Add equation', run: () => this.addCell('equation', insertAt) },
      { label: 'Add Python function', run: () => this.addCell('code', insertAt) },
      { label: 'Add note', run: () => this.addCell('note', insertAt) }
    ]);
  }

  protected cellContextMenu(event: MouseEvent, cell: Cell): void {
    if ((event.target as HTMLElement).closest('input, textarea, .mathquill-input, [contenteditable="true"]')) return;
    const index = this.cellIndex(cell);
    this.showContextMenu(event, this.cellLabel(cell), [
      { label: 'Duplicate card', run: () => this.duplicateCell(cell) },
      { label: 'Rename card', run: () => this.focusCellTitle(cell) },
      ...(cell.type === 'equation' || cell.type === 'code'
        ? [{ label: 'Run from this card', run: () => void this.runFromCell(cell), disabled: this.isRunning() }]
        : []),
      { label: this.collapsed().has(cell.id) ? 'Expand card' : 'Collapse card', run: () => this.toggleCollapsed(cell.id) },
      { label: 'Add equation below', run: () => this.addCell('equation', index + 1) },
      { label: 'Add Python function below', run: () => this.addCell('code', index + 1) },
      { label: 'Add note below', run: () => this.addCell('note', index + 1) },
      { label: 'Delete card', run: () => this.deleteCell(cell), danger: true }
    ]);
  }

  protected systemContextMenu(event: MouseEvent, system: Project): void {
    this.showContextMenu(event, system.name, [
      { label: 'Open system', run: () => this.selectSystem(system.id) },
      { label: 'Rename system', run: () => this.focusSystemTitle(system) },
      { label: 'Duplicate system', run: () => this.duplicateSystem(system) },
      { label: 'Export system JSON', run: () => this.exportSystem(system) },
      { label: 'Delete system', run: () => this.deleteSystem(system), disabled: this.workspace().systems.length === 1, danger: true }
    ]);
  }

  protected inputContextMenu(event: MouseEvent, parameter: EngineeringParameter): void {
    if ((event.target as HTMLElement).closest('input, textarea')) return;
    this.showContextMenu(event, parameter.name, [
      { label: `Find usages (${this.usageCounts().get(parameter.name) || 0})`, run: () => this.findVariableReferences(parameter.name, 'input') },
      { label: 'Duplicate input', run: () => this.duplicateParameter(parameter) },
      { label: 'Copy variable name', run: () => void this.copyText(parameter.name) },
      { label: 'Delete input', run: () => this.deleteParameter(parameter), danger: true }
    ]);
  }

  protected computedContextMenu(event: MouseEvent, variable: DisplayVariable): void {
    const producers = this.activeSystem()?.cells.filter(cell => cellProducesVariable(cell, variable.name)) || [];
    this.showContextMenu(event, variable.name, [
      { label: `Sources and usages (${this.usageCounts().get(variable.name) || 0})`, run: () => this.findVariableReferences(variable.name, 'computed') },
      { label: 'Jump to source', run: () => this.revealCell(producers[0]), disabled: producers.length !== 1 },
      { label: 'Copy variable name', run: () => void this.copyText(variable.name) },
      { label: 'Copy value', run: () => void this.copyText(variable.value) }
    ]);
  }

  protected readonly usageCounts = computed(() => {
    this.revision();
    const counts = new Map<string, number>();
    const available = new Set(this.availableVariableNames());
    for (const cell of this.activeSystem()?.cells || []) {
      const names = cell.type === 'equation' ? equationIdentifiers(cell.latex)
        : cell.type === 'code' ? codeIdentifiers(cell.source) : new Set<string>();
      for (const name of names) {
        if (available.has(name)) counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return counts;
  });

  protected findVariableReferences(name: string, kind: 'input' | 'computed'): void {
    const cells = this.activeSystem()?.cells || [];
    const producers = kind === 'computed' ? cells.filter(cell => cellProducesVariable(cell, name)) : [];
    this.variableReferences.set({
      name,
      kind,
      producers,
      usages: cells.filter(cell => cellUsesVariable(cell, name) && (kind === 'input' || !producers.includes(cell)))
    });
  }

  protected revealReference(cell: Cell): void {
    this.variableReferences.set(null);
    this.revealCell(cell);
  }

  private async copyText(value: string): Promise<void> {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          copied = true;
        } catch { /* Use the desktop webview's selection-based fallback. */ }
      }
      if (!copied) {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        copied = document.execCommand('copy');
        input.remove();
      }
      if (!copied) throw new Error('Clipboard is unavailable');
      this.showMessage('Copied to clipboard');
    } catch {
      this.showMessage('Clipboard access is unavailable');
    }
  }

  protected startDrag(event: DragEvent, cell: Cell): void {
    if (this.isRunning()) { event.preventDefault(); return; }
    this.draggedCell = cell.id;
    event.dataTransfer?.setData('text/plain', cell.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dropCell(event: DragEvent, target: Cell): void {
    event.preventDefault();
    const system = this.activeSystem();
    const source = system?.cells.findIndex(c => c.id === this.draggedCell) ?? -1;
    this.draggedCell = null;
    if (!system || source < 0 || this.isRunning()) return;
    const destination = system.cells.indexOf(target);
    if (destination < 0 || source === destination) return;
    const [cell] = system.cells.splice(source, 1);
    system.cells.splice(destination, 0, cell);
    this.markFromCellStale(system.cells[Math.min(source, destination)].id);
    this.recordChange('Calculation order changed; run again to update results');
  }
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

  protected parameterNames(): string[] {
    return this.activeSystem()?.parameters.map(parameter => parameter.name) || [];
  }

  protected availableVariableNames(): string[] {
    const system = this.activeSystem();
    if (!system) return [];
    const names = new Set(system.parameters.map(parameter => parameter.name));
    for (const cell of system.cells) {
      if (cell.type === 'code') cell.outputs.forEach(output => names.add(output.name));
      if ((cell.type === 'equation' || cell.type === 'code') && cell.context) {
        cell.context.variables.forEach(variable => names.add(variable.name));
      }
    }
    return [...names];
  }

  protected toggleTheme(): void {
    this.lightTheme.update(value => !value);
    localStorage.setItem('alpha-solve.theme', this.lightTheme() ? 'light' : 'dark');
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

  protected deleteSystem(system: Project, event?: MouseEvent): void {
    event?.stopPropagation();
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

  private focusSystemTitle(system: Project): void {
    this.selectSystem(system.id);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.system-title-input');
      input?.focus();
      input?.select();
    });
  }

  private duplicateSystem(system: Project): void {
    const copy = system.clone();
    copy.id = crypto.randomUUID();
    copy.name = `${system.name} Copy`;
    copy.solveDiagnostics = [];
    const refreshIds = (cells: Cell[]): void => {
      for (const cell of cells) {
        cell.id = crypto.randomUUID();
        if (cell.type === 'folder') refreshIds(cell.cells);
      }
    };
    refreshIds(copy.cells);
    copy.parameters = system.parameters.map(parameter => ({ ...parameter, id: crypto.randomUUID() }));
    copy.solverTargets = system.solverTargets.map(target => ({ ...target }));
    const index = this.workspace().systems.indexOf(system);
    this.workspace().systems.splice(index + 1, 0, copy);
    this.workspace().activeSystemId = copy.id;
    this.selectedCellId.set(null);
    this.recordChange('System duplicated');
  }

  protected addCell(type: 'equation' | 'note' | 'code', index?: number): void {
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

    if (index === undefined) system.addCell(cell);
    else system.cells.splice(Math.max(0, Math.min(index, system.cells.length)), 0, cell);
    this.selectedCellId.set(cell.id);
    this.markFromCellStale(cell.id);
    this.recordChange(`${this.cellLabel(cell)} added`);
    setTimeout(() => document.getElementById(`cell-${cell.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  private duplicateCell(cell: Cell): void {
    const system = this.activeSystem();
    if (!system) return;
    const index = system.cells.indexOf(cell);
    if (index < 0) return;
    const copy = CellSerializer.deserialize(CellSerializer.serialize(cell));
    copy.id = crypto.randomUUID();
    copy.createdAt = new Date();
    copy.updatedAt = new Date();
    if (copy.type === 'equation') {
      copy.title = `${copy.title} Copy`;
      copy.solutions = [];
      copy.context = undefined;
    } else if (copy.type === 'code') {
      copy.title = `${copy.title} Copy`;
      copy.outputs = copy.outputs.map(output => ({ ...output, value: '' }));
      copy.status = 'stale';
      copy.error = undefined;
      copy.stdout = '';
      copy.context = undefined;
    } else if (copy.type === 'note') copy.title = `${copy.title} Copy`;
    system.cells.splice(index + 1, 0, copy);
    this.selectedCellId.set(copy.id);
    this.markFromCellStale(copy.id);
    this.recordChange('Card duplicated');
    setTimeout(() => document.getElementById(`cell-${copy.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  private focusCellTitle(cell: Cell): void {
    this.revealCell(cell);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`#cell-${cell.id} .card-title input`);
      input?.focus();
      input?.select();
    });
  }

  private duplicateParameter(parameter: EngineeringParameter): void {
    const system = this.activeSystem();
    if (!system) return;
    let name = `${parameter.name}_copy`;
    let suffix = 2;
    while (system.parameters.some(item => item.name === name)) name = `${parameter.name}_copy${suffix++}`;
    const copy = { ...parameter, id: crypto.randomUUID(), name };
    const index = system.parameters.indexOf(parameter);
    system.parameters.splice(index + 1, 0, copy);
    this.parameterChanged();
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
    system.solveDiagnostics = [];
    system.updatedAt = new Date();
    const firstCell = system.cells[0];
    if (firstCell) this.markFromCellStale(firstCell.id);
    this.recordChange();
  }

  protected variableNameLatex(name: string): string {
    const separator = name.indexOf('_');
    const base = separator < 0 ? name : name.slice(0, separator);
    const greek = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']);
    const displayBase = greek.has(base) ? `\\${base}` : base;
    if (separator < 0) return displayBase;
    return `${displayBase}_{${name.slice(separator + 1)}}`;
  }

  protected parameterNameChanged(parameter: EngineeringParameter, latex: string): void {
    const normalized = latex
      .replace(/\\operatorname\{([^{}]+)\}/g, '$1')
      .replace(/_\{([^{}]*)\}/g, '_$1')
      .replace(/[{}\\\s]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '');
    if (!normalized || !/^[A-Za-z]/.test(normalized)) return;
    parameter.name = normalized;
    this.parameterChanged();
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

  protected addSolverTarget(): void {
    const system = this.activeSystem();
    if (!system) return;
    system.solverTargets.push({ name: '', guess: '', min: '', max: '' });
    this.parameterChanged();
  }

  protected removeSolverTarget(index: number): void {
    const system = this.activeSystem();
    if (!system) return;
    system.solverTargets.splice(index, 1);
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
      this.statusMessage.set(system.solveDiagnostics.length
        ? `Completed with ${system.solveDiagnostics.length} solver issue${system.solveDiagnostics.length === 1 ? '' : 's'}`
        : `Completed ${system.name} in ${system.lastSolvePasses} dependency pass${system.lastSolvePasses === 1 ? '' : 'es'}`);
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
      this.statusMessage.set(system.solveDiagnostics.length
        ? `Completed with ${system.solveDiagnostics.length} solver issue${system.solveDiagnostics.length === 1 ? '' : 's'}`
        : `Run complete · ${system.lastSolvePasses} dependency pass${system.lastSolvePasses === 1 ? '' : 'es'}`);
    } finally {
      this.isRunning.set(false);
      this.touch(false);
    }
  }

  protected newWorkspace(): void {
    this.syncProjects();
    this.collapsed.update(current => new Set([...current, this.workspace().id]));
    const project = this.createDemoWorkspace(false);
    project.name = `Project ${this.projects().length + 1}`;
    this.projects.update(projects => [...projects, project]);
    this.workspace.set(project);
    this.resetHistory();
    this.touch(true);
    this.showMessage('New workspace created');
  }

  protected saveWorkspace(): void {
    this.downloadJson(`${this.safeFileName(this.workspace().name)}.asolve`, this.workspace().toString());
  }

  protected openWorkspace(): void {
    this.chooseJsonFile(async text => {
      const raw = JSON.parse(text) as { format?: string };
      if (raw.format === WORKSPACE_FORMAT) {
        const project = Workspace.fromString(text);
        project.id = crypto.randomUUID();
        this.syncProjects();
        this.projects.update(projects => [...projects, project]);
        this.workspace.set(project);
      } else {
        const system = Project.fromString(text);
        this.syncProjects();
        this.workspace.set(new Workspace(system.name, [system], system.id));
        this.projects.update(projects => [...projects, this.workspace()]);
      }
      this.resetHistory();
      this.touch(true);
      this.showMessage('Workspace opened');
    });
  }

  protected exportSystem(system: Project | null = this.activeSystem()): void {
    if (!system) return;
    this.downloadJson(`${this.safeFileName(system.name)}.system.json`, system.toString());
  }

  protected exportLlmSystem(): void {
    const system = this.activeSystem();
    if (!system) return;
    const payload = {
      format: 'alpha-solve/llm-analysis',
      version: 1,
      purpose: 'Self-describing engineering model for analysis by a large language model.',
      instructions: [
        'Treat parameters as authoritative user inputs; preserve their units.',
        'Cells are calculations. Equations store LaTeX in latex; Python cells return named outputs.',
        'Use the exact canonical variable identifiers defined below. Identifiers are case-sensitive.',
        'Use explicit multiplication in equations: write x\\cdot y, never xy when x times y is intended.',
        'Calculation order is an initial evaluation order, not a one-way dependency rule. Re-evaluate dependencies until values stabilize.',
        'Solver targets specify canonical unknown names, initial guesses, and optional lower/upper bounds. Blank fields mean unspecified.',
        'Check dimensional consistency before trusting numerical conclusions. Clearly identify assumptions, unresolved symbols, and unsupported operations.'
      ],
      importFormat: {
        acceptedByAlphaSolve: [
          'A portable document whose root format is alpha-solve/system.',
          'This self-describing wrapper whose root format is alpha-solve/llm-analysis and whose system property is a complete alpha-solve/system object.'
        ],
        llmWrapperRequiredShape: {
          format: 'alpha-solve/llm-analysis',
          version: 1,
          system: 'REQUIRED: complete object matching portableSystemRequiredShape below'
        },
        portableSystemRequiredShape: {
          format: 'alpha-solve/system', version: 1, id: 'non-empty unique string',
          name: 'non-empty system name', description: 'plain-text engineering description',
          parameters: 'array of parameter objects in the exact parameter format below',
          solverTargets: 'optional array of {name, guess, min, max}; all values are strings, and blank numeric fields are omitted constraints',
          cells: 'array of equation, code, note, or folder cells in evaluation order',
          createdAt: 'ISO-8601 timestamp string', updatedAt: 'ISO-8601 timestamp string'
        },
        exactParameterFormat: {
          id: 'non-empty unique string',
          name: 'canonical identifier matching ^[A-Za-z][A-Za-z0-9_]*$',
          description: 'plain-text meaning and assumptions',
          value: 'string containing a decimal number or symbolic expression; never a JSON numeric value',
          unit: 'separate unit string such as Pa, GPa, kg/m^3, N·s/m, or empty for dimensionless',
          kind: 'input', valueType: 'numerical or analytical'
        },
        exactEquationCellFormat: {
          id: 'non-empty unique string', type: 'equation', title: 'human-readable equation name',
          latex: 'LaTeX equation using canonical variable identifiers and explicit \\cdot multiplication',
          context: { variables: [] }, solutions: [],
          createdAt: 'ISO-8601 timestamp string', updatedAt: 'ISO-8601 timestamp string'
        },
        exactSolverTargetFormat: {
          name: 'canonical unknown identifier matching ^[A-Za-z][A-Za-z0-9_]*$',
          guess: 'initial numerical guess as a string in coherent SI units, or empty string',
          min: 'optional lower bound as a string in coherent SI units, or empty string',
          max: 'optional upper bound as a string in coherent SI units, or empty string'
        },
        exactNoteCellFormat: {
          id: 'non-empty unique string', type: 'note', content: 'plain text',
          createdAt: 'ISO-8601 timestamp string', updatedAt: 'ISO-8601 timestamp string'
        },
        exactCodeCellFormat: {
          id: 'non-empty unique string', type: 'code', title: 'human-readable name',
          source: 'Python source containing exactly one top-level function', functionName: 'calculate',
          outputs: 'array of {name, value, unit}; names follow the canonical identifier rules',
          stdout: '', status: 'stale', context: { variables: [] },
          createdAt: 'ISO-8601 timestamp string', updatedAt: 'ISO-8601 timestamp string'
        },
        exactFolderCellFormat: {
          id: 'non-empty unique string', type: 'folder', name: 'human-readable folder name',
          cells: 'array of nested equation, code, note, or folder cells',
          createdAt: 'ISO-8601 timestamp string', updatedAt: 'ISO-8601 timestamp string'
        }
      },
      variableLabeling: {
        identifierPattern: '^[A-Za-z][A-Za-z0-9_]*$', caseSensitive: true,
        canonicalExamples: ['x', 'x_0', 'omega_n', 'sigma_max', 'TMR', 'P_c'],
        invalidExamples: ['x 0', 'mass-flow', '2theta', 'x₀'],
        subscripts: 'Store x subscript 0 as x_0. In LaTeX, x_0 or x_{0} both map to canonical x_0.',
        greekNames: 'Store Greek labels as ASCII names: omega_n, alpha, sigma_max. The UI renders recognized Greek names mathematically.',
        acronymsAndWords: 'Multi-letter names such as TMR and mass are one variable. Never concatenate names to imply multiplication.',
        equationReferences: 'Equations and Python arguments must exactly match parameter or computed-output spelling and capitalization.',
        multiplication: 'Always use \\cdot or \\times between variables. Example: F=m\\cdot a.'
      },
      valueEntry: {
        valuesAreStrings: true,
        numericalExamples: ['0.125', '210000000000', '1e-6'],
        analyticalExamples: ['sqrt(2)', 'pi/4'],
        unitsAreSeparate: 'Use value: "210" and unit: "GPa", not value: "210 GPa".',
        computedValues: 'Leave context.variables and solutions empty unless they are verified results.',
        pythonOutputs: 'A Python function returns a dictionary whose keys exactly match declared output names.'
      },
      solverCapabilities: this.solverCapabilities,
      organization: {
        parameters: 'Named input values with descriptions and units.',
        solverTargets: 'Optional solution-selection settings for unresolved variables.',
        cells: 'Ordered equation, Python function, note, or folder records.',
        context: 'Last converged set of named variables available across calculations.',
        solutions: 'Human-readable LaTeX results from the last run.'
      },
      system: system.toJSON()
    };
    this.downloadJson(`${this.safeFileName(system.name)}.llm.json`, JSON.stringify(payload, null, 2));
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
    if (cell.type === 'equation') return cell.title || 'Equation';
    if (cell.type === 'code') return cell.title || 'Python function';
    if (cell.type === 'note') return cell.title || 'Engineering note';
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
        unit: variable.unit || outputUnits.get(variable.name) || '',
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
      console.warn('The analytical plugin could not be loaded. The system solver and code cells remain available.', error);
    }

    try {
      this.statusMessage.set('Starting Python runtime…');
      await this.pythonExecutor.initialize(plugins);
      this.pluginCount.set(plugins.length);
      this.statusMessage.set(plugins.length > 0 ? 'Ready · analytical and system solvers loaded' : 'Ready · system solver available');
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
      this.syncProjects();
      localStorage.setItem(this.autosaveKey, this.workspace().toString());
      localStorage.setItem('alpha-solve.projects.v1', JSON.stringify(this.projects().map(p => p.toString())));
      this.autosaveTimer = null;
    }, 350);
  }

  private chooseJsonFile(onLoad: (text: string) => Promise<void>): void {
    if (isTauri()) {
      void invoke<string | null>('open_document').then(text => text === null ? undefined : onLoad(text))
        .catch(error => this.errorMessage.set(String(error)));
      return;
    }
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
    if (isTauri()) {
      void invoke<string | null>('save_document', { name: fileName, contents: json }).then(path => {
        if (path) { this.savedPath.set(path); this.showMessage(`Saved: ${path}`); }
      }).catch(error => this.errorMessage.set(String(error)));
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    this.savedPath.set(`Browser download: ${fileName}. Check your browser's Downloads folder.`);
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
    this.syncProjects();
    localStorage.setItem(this.autosaveKey, this.workspace().toString());
    localStorage.setItem('alpha-solve.projects.v1', JSON.stringify(this.projects().map(p => p.toString())));
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}
