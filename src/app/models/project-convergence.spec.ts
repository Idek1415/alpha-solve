import { CellSerializer } from './cell.model';
import { Variable } from './context.model';
import { Project } from './project.model';
import { PythonExecutorService } from '../services/python-executor.service';

describe('Project dependency convergence', () => {
  it('feeds values from later cells back into earlier dependent cells', async () => {
    const project = new Project('Convergence test');
    const earlier = CellSerializer.createCodeCell('needs_b');
    const later = CellSerializer.createCodeCell('creates_b');
    project.cells = [earlier, later];

    const executor = {
      executeCodeCell: async (source: string, context: { variables: Variable[] }) => {
        const values = new Map(context.variables.map(variable => [variable.name, variable]));
        if (source === 'needs_b') {
          if (!values.has('b')) throw new Error('b is not available yet');
          values.set('a', Variable.createNumerical('a', ['20']));
        } else {
          values.set('b', Variable.createNumerical('b', ['10']));
        }
        return {
          functionName: 'calculate',
          outputs: source === 'needs_b'
            ? [{ name: 'a', value: '20', unit: '' }]
            : [{ name: 'b', value: '10', unit: '' }],
          stdout: '',
          context: { variables: [...values.values()] }
        };
      }
    } as unknown as PythonExecutorService;

    await project.updateContext(earlier.id, executor);

    expect(earlier.status).toBe('success');
    expect(earlier.context?.variables.map(variable => variable.name)).toContain('a');
    expect(earlier.context?.variables.map(variable => variable.name)).toContain('b');
    expect(later.context?.variables.map(variable => variable.name)).toContain('a');
    expect(project.lastSolvePasses).toBeGreaterThan(1);
  });

  it('does not erase a known unit when a later result omits it', async () => {
    const project = new Project('Unit preservation test');
    const first = CellSerializer.createCodeCell('creates_force');
    const later = CellSerializer.createCodeCell('copies_context_without_units');
    first.outputs = [{ name: 'force', value: '', unit: 'N' }];
    project.cells = [first, later];

    const executor = {
      executeCodeCell: async (source: string, context: { variables: Variable[] }) => {
        const variables = context.variables.map(variable =>
          new Variable(variable.name, variable.type, [...variable.values], ''));
        if (source === 'creates_force' && !variables.some(variable => variable.name === 'force')) {
          variables.push(Variable.createNumerical('force', ['12']));
        }
        return {
          functionName: 'calculate',
          outputs: source === 'creates_force' ? [{ name: 'force', value: '12', unit: '' }] : [],
          stdout: '',
          context: { variables }
        };
      }
    } as unknown as PythonExecutorService;

    await project.updateContext(first.id, executor);

    expect(first.context?.variables.find(variable => variable.name === 'force')?.unit).toBe('N');
    expect(later.context?.variables.find(variable => variable.name === 'force')?.unit).toBe('N');
  });

  it('adds coupled-system results to the shared context and preserves solver settings', async () => {
    const project = new Project('Coupled system');
    const first = CellSerializer.createEquationCell('x+y=3');
    const second = CellSerializer.createEquationCell('x-y=1');
    project.cells = [first, second];
    project.solverTargets = [{ name: 'x', guess: '2', min: '0', max: '10' }];
    const executor = {
      getAvailableProcMacros: () => [],
      getAvailableFunctions: () => [],
      solveEquationSystem: jasmine.createSpy('solveEquationSystem').and.resolveTo({
        variables: { x: { value: '2', method: 'symbolic' }, y: { value: '1', method: 'symbolic' } },
        solutionsByCell: { [first.id]: ['x=2'], [second.id]: ['y=1'] },
        blockedVariables: [], blockedCells: [],
        diagnostics: []
      })
    } as unknown as PythonExecutorService;

    await project.updateContext(first.id, executor);

    expect(first.context?.variables.find(variable => variable.name === 'x')?.values).toEqual(['2']);
    expect(second.context?.variables.find(variable => variable.name === 'y')?.values).toEqual(['1']);
    expect(first.solutions).toEqual(['x=2']);
    expect((executor.solveEquationSystem as jasmine.Spy).calls.mostRecent().args[0].targets)
      .toEqual(project.solverTargets);
    expect(Project.fromString(project.toString()).solverTargets).toEqual(project.solverTargets);
  });

  it('removes a stale plugin answer when the coupled solver finds ambiguity', async () => {
    const project = new Project('Ambiguous system');
    const cell = CellSerializer.createEquationCell('x^2=4');
    cell.solutions = ['x=2'];
    project.cells = [cell];
    const context = { variables: [Variable.createNumerical('x', ['2'])] };
    const executor = {
      solveEquationSystem: async () => ({
        variables: {}, solutionsByCell: {}, blockedVariables: ['x'],
        blockedCells: [cell.id], diagnostics: ['multiple solutions']
      })
    } as unknown as PythonExecutorService;

    const result = await (project as any).solveCoupledEquations([cell], context, { variables: [] }, new Set(), executor);

    expect(result.variables).toEqual([]);
    expect(cell.solutions).toEqual([]);
    expect(project.solveDiagnostics).toEqual(['multiple solutions']);
  });
});
