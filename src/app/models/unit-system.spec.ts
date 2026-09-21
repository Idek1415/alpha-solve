import { inferEquationUnit, normalizeValueToSI, parseUnit, sameDimensions } from './unit-system';

describe('engineering unit system', () => {
  it('normalizes prefixed SI inputs', () => {
    expect(normalizeValueToSI('210', 'GPa')).toEqual({ value: '210000000000', unit: 'Pa' });
    expect(normalizeValueToSI('25', 'mm')).toEqual({ value: '0.025', unit: 'm' });
  });

  it('recognizes equivalent compound dimensions', () => {
    expect(parseUnit('N·s/m')).not.toBeNull();
    expect(sameDimensions('N', 'kg*m/s^2')).toBeTrue();
  });

  it('infers the output unit of a direct engineering equation', () => {
    const units = new Map([['m', 'kg'], ['a', 'm/s^2']]);
    expect(inferEquationUnit('F=m\\cdot a', 'F', units)).toBe('N');
  });

  it('infers a solved variable inside products, quotients, and powers', () => {
    expect(inferEquationUnit(
      'mdot_f=rho_f\\cdot A_f\\cdot U_f',
      'A_f',
      new Map([['mdot_f', 'kg/s'], ['rho_f', 'kg/m^3'], ['U_f', 'm/s']])
    )).toBe('m^2');
    expect(inferEquationUnit(
      'BF=\\frac{N_f\\cdot d_f}{\\pi\\cdot D_p}',
      'D_p',
      new Map([['BF', ''], ['N_f', ''], ['d_f', 'm']])
    )).toBe('m');
    expect(inferEquationUnit(
      'A_f=N_f\\cdot\\frac{\\pi\\cdot d_f^2}{4}',
      'd_f',
      new Map([['A_f', 'm^2'], ['N_f', '']])
    )).toBe('m');
  });

  it('infers units through roots, Greek names, and additive geometry', () => {
    expect(inferEquationUnit(
      'U_ox=Cd_ox\\cdot\\sqrt{\\frac{2\\cdot dP_ox}{rho_ox}}',
      'U_ox',
      new Map([['Cd_ox', ''], ['dP_ox', 'Pa'], ['rho_ox', 'kg/m^3']])
    )).toBe('m/s');
    expect(inferEquationUnit(
      'A_ox=\\pi\\cdot\\left[\\left(\\frac{D_p}{2}+\\delta_ox\\right)^2-\\left(\\frac{D_p}{2}\\right)^2\\right]',
      'delta_ox',
      new Map([['A_ox', 'm^2'], ['D_p', 'm']])
    )).toBe('m');
  });
});
