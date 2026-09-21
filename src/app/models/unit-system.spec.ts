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
});
