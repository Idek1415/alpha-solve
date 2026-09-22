import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { CellSerializer } from './models';

describe('App', () => {
  beforeEach(async () => {
    spyOn<any>(App.prototype, 'initializeRuntime').and.returnValue(Promise.resolve());
    spyOn(Storage.prototype, 'getItem').and.returnValue(null);
    spyOn(Storage.prototype, 'setItem');
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-title')?.textContent).toContain('Alpha Solve');
  });

  it('uses light caret, variable editor, and scrollbar colors only in light mode', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance as any;
    const shell = fixture.nativeElement.querySelector('.application-shell') as HTMLElement;
    const parameterValue = shell.querySelector('.parameter-value') as HTMLInputElement;
    const variableEditor = shell.querySelector('.parameter-name-editor .mathquill-input') as HTMLElement;

    app.toggleTheme();
    fixture.detectChanges();

    expect(shell.classList.contains('light-theme')).toBeTrue();
    expect(getComputedStyle(parameterValue).caretColor).toBe('rgb(23, 44, 61)');
    expect(getComputedStyle(variableEditor).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(variableEditor).color).toBe('rgb(32, 49, 62)');
    expect(getComputedStyle(shell).colorScheme).toBe('light');
    expect(getComputedStyle(shell.querySelector('.parameter-table')!).scrollbarColor)
      .toBe('rgb(174, 187, 197) rgb(237, 241, 244)');

    app.toggleTheme();
    fixture.detectChanges();
    expect(shell.classList.contains('light-theme')).toBeFalse();
    expect(getComputedStyle(parameterValue).caretColor).toBe('rgb(255, 255, 255)');
  });

  it('retains the original project when creating and switching projects', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const original = app.workspace();
    original.name = 'Original design';
    app.newWorkspace();
    expect(app.projects().length).toBe(2);
    expect(app.workspace().id).not.toBe(original.id);
    app.activateProject(original);
    expect(app.workspace().name).toBe('Original design');
  });

  it('reorders dropped cards and undo restores the original order', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const system = app.activeSystem();
    const original = system.cells.map((c: any) => c.id);
    const event = { preventDefault() {}, dataTransfer: { setData() {}, effectAllowed: '' } };
    app.startDrag(event, system.cells[0]);
    app.dropCell(event, system.cells[2]);
    expect(system.cells.map((c: any) => c.id)).toEqual([original[1], original[2], original[0]]);
    app.undo();
    expect(app.activeSystem().cells.map((c: any) => c.id)).toEqual(original);
  });

  it('collapses and expands a calculation without removing its data', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const cell = app.activeSystem().cells[0];
    app.toggleCollapsed(cell.id);
    expect(app.collapsed().has(cell.id)).toBeTrue();
    app.toggleCollapsed(cell.id);
    expect(app.collapsed().has(cell.id)).toBeFalse();
    expect(app.activeSystem().cells[0]).toBe(cell);
  });

  it('exports self-describing LLM input and variable-format rules', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const download = spyOn(app, 'downloadJson');

    app.exportLlmSystem();

    const payload = JSON.parse(String(download.calls.mostRecent().args[1]));
    expect(payload.format).toBe('alpha-solve/llm-analysis');
    expect(payload.importFormat.portableSystemRequiredShape.format).toBe('alpha-solve/system');
    expect(payload.variableLabeling.identifierPattern).toBe('^[A-Za-z][A-Za-z0-9_]*$');
    expect(payload.valueEntry.valuesAreStrings).toBeTrue();
    expect(payload.system.format).toBe('alpha-solve/system');
  });

  it('adds a calculation at the right-clicked workspace position and supports undo', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance as any;
    const before = app.activeSystem().cells.map((cell: any) => cell.id);
    const workspace = fixture.nativeElement.querySelector('.cards-scroll') as HTMLElement;
    workspace.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 0 }));
    fixture.detectChanges();
    const addButton = Array.from(fixture.nativeElement.querySelectorAll('.context-menu button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('Add equation'))!;
    addButton.click();
    expect(app.activeSystem().cells[0].type).toBe('equation');
    expect(app.activeSystem().cells.slice(1).map((cell: any) => cell.id)).toEqual(before);
    app.undo();
    expect(app.activeSystem().cells.map((cell: any) => cell.id)).toEqual(before);
  });

  it('finds exact input usages and jumps to the selected card', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const system = app.activeSystem();
    const displacement = system.parameters.find((parameter: any) => parameter.name === 'x_0');
    app.findVariableReferences(displacement.name, 'input');
    expect(app.variableReferences().usages.length).toBe(1);
    expect(app.variableReferences().usages[0].type).toBe('equation');
    const cell = app.variableReferences().usages[0];
    app.revealReference(cell);
    expect(app.selectedCellId()).toBe(cell.id);
    expect(app.variableReferences()).toBeNull();
  });

  it('duplicates systems with distinct system, cell, and parameter identities', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const original = app.activeSystem();
    app.duplicateSystem(original);
    const copy = app.activeSystem();
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toContain('Copy');
    expect(copy.cells.map((cell: any) => cell.id)).not.toEqual(original.cells.map((cell: any) => cell.id));
    expect(copy.parameters.map((parameter: any) => parameter.id))
      .not.toEqual(original.parameters.map((parameter: any) => parameter.id));
    expect(app.workspace().systems.length).toBe(2);
  });

  it('preserves note titles when a card is duplicated and the workspace is serialized', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const note = app.activeSystem().cells[0];
    note.title = 'Assumptions';
    app.duplicateCell(note);
    const duplicate = app.activeSystem().cells[1];
    expect(duplicate.title).toBe('Assumptions Copy');
    expect(JSON.parse(app.workspace().toString()).systems[0].cells[1].title).toBe('Assumptions Copy');
  });

  it('accepts Greek input parameter names and preserves their canonical subscripts', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const parameter = app.activeSystem().parameters[0];
    app.parameterNameChanged(parameter, '\\rho_{ox}');
    expect(parameter.name).toBe('rho_ox');
    expect(app.variableNameLatex(parameter.name)).toBe('\\rho_{ox}');
    app.parameterNameChanged(parameter, 'α');
    expect(parameter.name).toBe('alpha');
  });

  it('suggests only unresolved inputs and respects outputs from future equations', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const system = app.activeSystem();
    const force = CellSerializer.createEquationCell('F=m\\cdot a');
    const mass = CellSerializer.createEquationCell('m=\\rho\\cdot V');
    system.parameters = [];
    system.cells = [force, mass];
    app.revision.update((value: number) => value + 1);
    expect(app.missingVariablesFor(force)).toEqual(['a']);
    expect(app.missingVariablesFor(mass)).toEqual(['rho', 'V']);
    app.addSuggestedParameter('a');
    expect(system.parameters.map((parameter: any) => parameter.name)).toEqual(['a']);
    expect(app.missingVariablesFor(force)).toEqual([]);
  });

  it('suggests a composite Greek variable as one input even when its Latin suffix exists', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const system = app.activeSystem();
    const equation = CellSerializer.createEquationCell('alpha=\\frac{\\Delta R}{R_0\\cdot T}');
    system.parameters = [
      { id: 'r', name: 'R', value: '2.1', unit: 'm', description: '', kind: 'input', valueType: 'numerical' },
      { id: 'r0', name: 'R_0', value: '69.6', unit: 'm', description: '', kind: 'input', valueType: 'numerical' },
      { id: 't', name: 'T', value: '216', unit: 's', description: '', kind: 'input', valueType: 'numerical' }
    ];
    system.cells = [equation];
    app.revision.update((value: number) => value + 1);
    expect(app.missingVariablesFor(equation)).toEqual(['DeltaR']);
    app.addSuggestedParameter('DeltaR');
    expect(system.parameters.at(-1).name).toBe('DeltaR');
    expect(app.variableNameLatex('DeltaR')).toBe('\\Delta R');
  });

  it('deletes the selected project and keeps another project active', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const original = app.workspace();
    app.newWorkspace();
    const added = app.workspace();
    app.deleteProject(added);
    expect(app.projects().map((project: any) => project.id)).toEqual([original.id]);
    expect(app.workspace().id).toBe(original.id);
    app.deleteProject(original);
    expect(app.projects().length).toBe(1);
  });
});
