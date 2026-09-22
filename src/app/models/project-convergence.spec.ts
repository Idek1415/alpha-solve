import { CellSerializer } from './cell.model';
import { Variable } from './context.model';
import { Project } from './project.model';
import { PythonExecutorService } from '../services/python-executor.service';

describe('Project dependency convergence', () => {
  it('keeps branch lists without passing Cartesian root combinations to scalar plugins', async () => {
    const project = new Project('Root branches');
    const root = CellSerializer.createEquationCell('x^2=4');
    const dependent = CellSerializer.createEquationCell('y=x+1');
    project.cells = [root, dependent];
    const executor = {
      getAvailableProcMacros: () => [],
      getAvailableFunctions: () => [{ functionName: 'solve' }],
      callMetaFunction: async () => ({ result: { index: 0, useResult: true } }),
      callFunction: async (_name: string, input: any) => {
        expect(input.context.variables.every((v: Variable) => v.values.length === 1)).toBeTrue();
        const value = input.cell.id === root.id
          ? Variable.createNumerical('x', ['-2', '2']) : Variable.createAnalytical('y', ['x + 1']);
        return { result: { newContext: { variables: [value] } } };
      }
    } as unknown as PythonExecutorService;
    await project.updateContext(root.id, executor);
    expect(dependent.context?.variables.find(v => v.name === 'x')?.values).toEqual(['-2', '2']);
    expect(dependent.context?.variables.find(v => v.name === 'y')?.values).toEqual(['x + 1']);
  });

  it('reports oscillating dependencies rather than claiming convergence', async () => {
    const project = new Project('Cycle');
    const cell = CellSerializer.createCodeCell('toggle');
    project.cells = [cell];
    const executor = {
      executeCodeCell: async (_source: string, context: { variables: Variable[] }) => {
        const value = context.variables[0]?.values[0] === '0' ? '1' : '0';
        return { functionName: 'toggle', stdout: '', outputs: [{ name: 'x', value, unit: '' }],
          context: { variables: [Variable.createNumerical('x', [value])] } };
      }
    } as unknown as PythonExecutorService;
    await project.updateContext(cell.id, executor);
    expect(project.solveDiagnostics.some(diagnostic => diagnostic.includes('not converged'))).toBeTrue();
  });

  it('does not hide an equation check that returns False', async () => {
    const project = new Project('Contradiction');
    const cell = CellSerializer.createEquationCell('x=2');
    cell.solutions = ['x=2'];
    const executor = {
      getAvailableProcMacros: () => [],
      getAvailableFunctions: () => [{ functionName: 'check' }],
      callMetaFunction: async () => ({ result: { index: 0, useResult: true } }),
      callFunction: async () => ({ result: { visibleSolutions: ['False'] } })
    } as unknown as PythonExecutorService;
    await (project as any).updateCellContext(cell, { variables: [] }, executor);
    expect(cell.solutions).toEqual(['False']);
  });
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

  it('keeps a solved value and card result when a later pass cannot solve the group', async () => {
    const project = new Project('Stable results');
    const cell = CellSerializer.createEquationCell('x=2');
    project.cells = [cell];
    const executor = {
      getAvailableProcMacros: () => [],
      getAvailableFunctions: () => [],
      solveEquationSystem: jasmine.createSpy('solveEquationSystem').and.returnValues(
        Promise.resolve({
          variables: { x: { value: '2', method: 'symbolic' } },
          solutionsByCell: { [cell.id]: ['x=2'] },
          blockedVariables: [], blockedCells: [], diagnostics: []
        }),
        Promise.resolve({
          variables: {}, solutionsByCell: {}, blockedVariables: [], blockedCells: [],
          diagnostics: ['Set an initial guess for every unknown in this group.']
        })
      )
    } as unknown as PythonExecutorService;

    await project.updateContext(cell.id, executor);

    expect(project.lastSolvePasses).toBe(2);
    expect(cell.context?.variables.find(variable => variable.name === 'x')?.values).toEqual(['2']);
    expect(cell.solutions).toEqual(['x=2']);
    expect(project.solveDiagnostics).toContain('Set an initial guess for every unknown in this group.');
  });

  it('carries a later scalar value into an earlier symbolic result', async () => {
    const project = new Project('Symbolic dependency');
    const ratio = CellSerializer.createEquationCell('BF=0.381/LMR');
    const target = CellSerializer.createEquationCell('LMR=1');
    project.cells = [ratio, target];
    const executor = {
      getAvailableProcMacros: () => [],
      getAvailableFunctions: () => [{ functionName: 'mock' }],
      callMetaFunction: async () => ({ result: { index: 0, name: 'mock', useResult: true } }),
      callFunction: async (_name: string, input: { cell: { latex: string }; context: { variables: Variable[] } }) => {
        const isRatio = input.cell.latex.startsWith('BF');
        const variable = Variable.createNumerical(isRatio ? 'BF' : 'LMR', [isRatio ? '0.381/LMR' : '1']);
        return {
          result: {
            newContext: { variables: [...input.context.variables, variable] },
            visibleSolutions: [isRatio ? 'BF=0.381/LMR' : 'LMR=1']
          }
        };
      },
      resolveComputedValues: jasmine.createSpy('resolveComputedValues').and.callFake(async (
        input: { variables: Variable[]; solutionsByCell: Record<string, string[]> }
      ) => {
        const hasTarget = input.variables.some(variable => variable.name === 'LMR');
        return {
          variables: input.variables.map(variable => variable.name === 'BF' && hasTarget
            ? Variable.createNumerical('BF', ['0.381']) : variable),
          solutionsByCell: { ...input.solutionsByCell, [ratio.id]: hasTarget ? ['BF=0.381'] : ['BF=0.381/LMR'] }
        };
      })
    } as unknown as PythonExecutorService;

    await project.updateContext(ratio.id, executor);

    expect(ratio.context?.variables.find(variable => variable.name === 'BF')?.values).toEqual(['0.381']);
    expect(ratio.solutions).toEqual(['BF=0.381']);
    expect((executor.resolveComputedValues as jasmine.Spy).calls.mostRecent().args[0].variables
      .some((variable: Variable) => variable.name === 'LMR')).toBeTrue();
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
