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
});
