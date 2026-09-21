import { CellSerializer } from './cell.model';
import { createEngineeringParameter } from './engineering-parameter.model';
import { Project, SYSTEM_FORMAT } from './project.model';
import { Workspace } from './workspace.model';

describe('Workspace serialization', () => {
  it('round-trips parameters and executable code cells', () => {
    const system = new Project('Suspension model');
    system.description = 'Quarter-car calculation';
    system.parameters = [createEngineeringParameter('mass', '250', 'kg', 'Sprung mass')];
    system.addCell(CellSerializer.createCodeCell(
      'def calculate(mass):\n    return {"weight": mass * 9.81}'
    ));

    const restored = Workspace.fromString(new Workspace('Vehicle study', [system]).toString());

    expect(restored.name).toBe('Vehicle study');
    expect(restored.activeSystem?.parameters[0].unit).toBe('kg');
    expect(restored.activeSystem?.cells[0].type).toBe('code');
  });

  it('rejects system documents created by a newer incompatible version', () => {
    expect(() => Project.fromJSON({
      format: SYSTEM_FORMAT,
      version: 999,
      id: 'future-system',
      name: 'Future',
      description: '',
      parameters: [],
      cells: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })).toThrowError(/newer than this application supports/);
  });

  it('imports a system nested in an LLM analysis export', () => {
    const system = new Project('Wrapped system');
    const wrapped = JSON.stringify({
      format: 'alpha-solve/llm-analysis',
      version: 1,
      instructions: ['Untrusted descriptive metadata'],
      system: system.toJSON()
    });

    const restored = Project.fromString(wrapped);

    expect(restored.name).toBe('Wrapped system');
    expect(restored.id).toBe(system.id);
  });
});
