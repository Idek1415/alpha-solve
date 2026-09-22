import { formatDimensions, inferEquationUnit, normalizeValueToSI, parseUnit, sameDimensions } from './unit-system';

describe('engineering unit system', () => {
  it('round-trips compound denominators and fractional dimensions', () => {
    for (const text of ['kg/(m*s^2)', '1/m/s', 'm^(1/2)', 'kg*m^-2*s^-1']) {
      const parsed = parseUnit(text)!;
      expect(parsed).not.toBeNull();
      expect(parseUnit(formatDimensions(parsed.dimensions))?.dimensions).toEqual(parsed.dimensions);
    }
    expect(sameDimensions('kg/(m*s^2)', 'Pa')).toBeTrue();
    expect(parseUnit('m/')).toBeNull();
    expect(parseUnit('m**s')).toBeNull();
  });

  it('converts angle and mass scales without converting a missing input to zero', () => {
    expect(normalizeValueToSI('180', 'deg').value).toBe(String(Math.PI));
    expect(normalizeValueToSI('1000', 'g')).toEqual({ value: '1', unit: 'kg' });
    expect(normalizeValueToSI('', 'mm').value).toBe('');
  });

  it('infers dimensions through nested and indexed roots and negative powers', () => {
    expect(inferEquationUnit('L=\\sqrt[3]{V}', 'L', new Map([['V', 'm^3']]))).toBe('m');
    expect(inferEquationUnit('r=\\frac{1}{\\sqrt{A}}', 'r', new Map([['A', 'm^2']]))).toBe('1/m');
    expect(inferEquationUnit('r=x^{-2}', 'r', new Map([['x', 'm']]))).toBe('1/m^2');
    expect(inferEquationUnit('x=0.5\\cdot y', 'x', new Map([['y', 'm']]))).toBe('m');
    expect(inferEquationUnit('x=\\bogus{y}', 'x', new Map([['y', 'm']]))).toBe('');
  });
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
