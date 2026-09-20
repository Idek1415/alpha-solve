import { TestBed } from '@angular/core/testing';
import { App } from './app';

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
});
