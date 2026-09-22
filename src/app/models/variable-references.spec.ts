import { CellSerializer } from './cell.model';
import {
  canonicalVariableName,
  cellProducesVariable,
  cellUsesVariable,
  codeDeclaredOutputs,
  codeFunctionArguments,
  codeIdentifiers,
  equationIdentifiers
} from './variable-references';

describe('variable references', () => {
  it('matches canonical equation names including subscripts without prefix matches', () => {
    const names = equationIdentifiers('F=\\frac{\\rho_{ox}\\cdot U_{ox}^{2}}{x_0}+\\operatorname{A_f}');
    expect(names.has('rho_ox')).toBeTrue();
    expect(names.has('U_ox')).toBeTrue();
    expect(names.has('x_0')).toBeTrue();
    expect(names.has('A_f')).toBeTrue();
    expect(names.has('x')).toBeFalse();
    expect(names.has('rho')).toBeFalse();
    expect(names.has('frac')).toBeFalse();
  });

  it('finds Python arguments and expressions without matching comments or output labels', () => {
    const source = 'def calculate(x_0):\n    # x is not used\n    return {"x": x_0 + 1}';
    expect(codeIdentifiers(source).has('x_0')).toBeTrue();
    expect(codeIdentifiers(source).has('x')).toBeFalse();
    const cell = CellSerializer.createCodeCell(source);
    cell.outputs = [{ name: 'x', value: '2' }];
    expect(cellUsesVariable(cell, 'x_0')).toBeTrue();
    expect(cellProducesVariable(cell, 'x')).toBeTrue();
  });

  it('identifies equation results as possible sources', () => {
    const cell = CellSerializer.createEquationCell('LMR=\\frac{TMR}{BF}');
    expect(cellProducesVariable(cell, 'LMR')).toBeTrue();
    expect(cellProducesVariable(cell, 'BF')).toBeFalse();
    cell.solutions = ['BF=0.38/LMR'];
    expect(cellProducesVariable(cell, 'BF')).toBeTrue();
  });

  it('normalizes typed and pasted Greek parameter names with subscripts', () => {
    expect(canonicalVariableName('\\rho_{ox}')).toBe('rho_ox');
    expect(canonicalVariableName('ρ_{ox}')).toBe('rho_ox');
    expect(canonicalVariableName('\\varphi')).toBe('phi');
    expect(equationIdentifiers('F=\\rho_{ox}\\cdot A').has('rho_ox')).toBeTrue();
  });

  it('recognizes future Python inputs and declared outputs without running code', () => {
    const cell = CellSerializer.createCodeCell('def calculate(rho, A=1):\n    return {"mdot": rho * A}');
    expect([...codeFunctionArguments(cell.source)]).toEqual(['rho', 'A']);
    expect(codeDeclaredOutputs(cell).has('mdot')).toBeTrue();
    expect(cellProducesVariable(cell, 'mdot')).toBeTrue();
  });
});
