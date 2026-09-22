export type Dimensions = [number, number, number, number, number, number, number];

interface UnitValue {
  dimensions: Dimensions;
  scale: number;
}

const zero = (): Dimensions => [0, 0, 0, 0, 0, 0, 0];
const unit = (dimensions: Dimensions, scale = 1): UnitValue => ({ dimensions, scale });

const UNITS: Record<string, UnitValue> = {
  '': unit(zero()),
  '1': unit(zero()),
  m: unit([1, 0, 0, 0, 0, 0, 0]),
  kg: unit([0, 1, 0, 0, 0, 0, 0]),
  s: unit([0, 0, 1, 0, 0, 0, 0]),
  A: unit([0, 0, 0, 1, 0, 0, 0]),
  K: unit([0, 0, 0, 0, 1, 0, 0]),
  mol: unit([0, 0, 0, 0, 0, 1, 0]),
  cd: unit([0, 0, 0, 0, 0, 0, 1]),
  Hz: unit([0, 0, -1, 0, 0, 0, 0]),
  N: unit([1, 1, -2, 0, 0, 0, 0]),
  Pa: unit([-1, 1, -2, 0, 0, 0, 0]),
  J: unit([2, 1, -2, 0, 0, 0, 0]),
  W: unit([2, 1, -3, 0, 0, 0, 0]),
  C: unit([0, 0, 1, 1, 0, 0, 0]),
  V: unit([2, 1, -3, -1, 0, 0, 0]),
  rad: unit(zero()),
  deg: unit(zero(), Math.PI / 180),
  g: unit([0, 1, 0, 0, 0, 0, 0], 1e-3)
};

const PREFIXES: Record<string, number> = {
  G: 1e9, M: 1e6, k: 1e3, c: 1e-2, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9
};

function multiply(left: UnitValue, right: UnitValue, power = 1): UnitValue {
  return unit(
    left.dimensions.map((value, index) => value + right.dimensions[index] * power) as Dimensions,
    left.scale * right.scale ** power
  );
}

function atomicUnit(symbol: string): UnitValue | null {
  if (UNITS[symbol]) return UNITS[symbol];
  const prefix = symbol[0];
  const base = symbol.slice(1);
  if (PREFIXES[prefix] && UNITS[base]) {
    return unit(UNITS[base].dimensions, PREFIXES[prefix] * UNITS[base].scale);
  }
  return null;
}

/** Parse common SI and engineering compound units such as GPa, N*m, and m/s^2. */
export function parseUnit(text: string): UnitValue | null {
  const normalized = text.trim().replace(/[·⋅]/g, '*').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\s+/g, '');
  if (!normalized) return unit(zero());
  const source = normalized.replace(/([A-Za-zµ]+)(-?\d+)/g, '$1^$2');
  const tokens = source.match(/[A-Za-zµ]+|(?:\d+(?:\.\d*)?|\.\d+)|[()^*/+-]/g) || [];
  if (tokens.join('') !== source) return null;
  let index = 0;
  const factor = (): UnitValue | null => {
    const token = tokens[index++];
    let value: UnitValue | null;
    if (token === '(') {
      value = product();
      if (tokens[index++] !== ')') return null;
    } else {
      value = token === '1' ? unit(zero()) : token ? atomicUnit(token) : null;
    }
    if (!value) return null;
    if (tokens[index] === '^') {
      index++;
      const grouped = tokens[index] === '(';
      if (grouped) index++;
      let sign = 1;
      if (tokens[index] === '-' || tokens[index] === '+') sign = tokens[index++] === '-' ? -1 : 1;
      let power = sign * Number(tokens[index++]);
      if (grouped && tokens[index] === '/') {
        index++;
        power /= Number(tokens[index++]);
      }
      if (!Number.isFinite(power) || (grouped && tokens[index++] !== ')')) return null;
      value = unit(value.dimensions.map(dimension => dimension * power) as Dimensions, value.scale ** power);
    }
    return value;
  };
  const product = (): UnitValue | null => {
    let value = factor();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const direction = tokens[index++] === '*' ? 1 : -1;
      const right = factor();
      if (!value || !right) return null;
      value = multiply(value, right, direction);
    }
    return value;
  };
  const result = product();
  return index === tokens.length ? result : null;
}

export function normalizeValueToSI(value: string, unitText: string): { value: string; unit: string } {
  const parsed = parseUnit(unitText);
  const numeric = Number(value);
  if (!value.trim() || !parsed || !Number.isFinite(numeric) || parsed.scale === 1) return { value, unit: unitText };
  return { value: String(numeric * parsed.scale), unit: formatDimensions(parsed.dimensions) };
}

export function formatDimensions(dimensions: Dimensions): string {
  const known = Object.entries(UNITS).find(([, candidate]) =>
    candidate.scale === 1 && candidate.dimensions.every((value, index) => value === dimensions[index]));
  if (known && known[0] !== '1') return known[0];
  const bases = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'];
  const numerator: string[] = [];
  const denominator: string[] = [];
  dimensions.forEach((power, index) => {
    if (!power) return;
    const target = power > 0 ? numerator : denominator;
    const magnitude = Math.abs(power);
    target.push(`${bases[index]}${magnitude === 1 ? '' : `^${magnitude}`}`);
  });
  const top = numerator.join('·') || '1';
  return denominator.length ? `${top}/${denominator.join('/')}` : (top === '1' ? '' : top);
}

export function sameDimensions(left: string, right: string): boolean {
  const a = parseUnit(left), b = parseUnit(right);
  return !!a && !!b && a.dimensions.every((value, index) => value === b.dimensions[index]);
}

function normalizeLatexExpression(latex: string): string {
  let value = latex
    .replace(/\\operatorname\{([^{}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega)(?![A-Za-z])/g, '$1')
    .replace(/\\pi(?![A-Za-z])/g, 'pi')
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\[,;:!]/g, '')
    .replace(/\s+/g, '');
  // Peel off innermost groups irrespective of whether a fraction or radical
  // encloses the other. Flatten exponent braces as part of the same pass.
  for (let index = 0; index < 100; index++) {
    const next = value
      .replace(/\^\{([^{}]+)\}/g, '^($1)')
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
      .replace(/\\sqrt(?:\[(\d+)\])?\{([^{}]+)\}/g, (_match, degree, body) =>
        Number(degree || 2) > 0 ? `((${body})^(${1 / Number(degree || 2)}))` : '\\invalid');
    if (next === value) break;
    value = next;
  }
  value = value.replace(/[{}\[\]]/g, match => match === '{' || match === '[' ? '(' : ')');
  return value;
}

interface DimensionExpression {
  /** Known part of the dimensions plus targetPower times the unknown target dimensions. */
  dimensions: Dimensions;
  targetPower: number;
}

class DimensionExpressionParser {
  private index = 0;
  readonly constraints: Array<[DimensionExpression, DimensionExpression]> = [];

  constructor(
    private readonly tokens: string[],
    private readonly units: Map<string, UnitValue>,
    private readonly targetName: string
  ) {}

  parse(): DimensionExpression | null {
    const value = this.sum();
    return value && this.index === this.tokens.length ? value : null;
  }

  private sum(): DimensionExpression | null {
    let value = this.product();
    while (this.peek() === '+' || this.peek() === '-') {
      this.index++;
      const right = this.product();
      if (!value || !right) return null;
      this.constraints.push([value, right]);
    }
    return value;
  }

  private product(): DimensionExpression | null {
    let value = this.power();
    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.tokens[this.index++];
      const right = this.power();
      if (!value || !right) return null;
      const direction = operator === '*' ? 1 : -1;
      value = {
        dimensions: value.dimensions.map((item, index) => item + direction * right.dimensions[index]) as Dimensions,
        targetPower: value.targetPower + direction * right.targetPower
      };
    }
    return value;
  }

  private power(): DimensionExpression | null {
    let value = this.primary();
    if (this.peek() === '^') {
      this.index++;
      const grouped = this.peek() === '(';
      if (grouped) this.index++;
      let sign = 1;
      if (this.peek() === '-' || this.peek() === '+') sign = this.tokens[this.index++] === '-' ? -1 : 1;
      let exponent = sign * Number(this.tokens[this.index++]);
      if (grouped && this.peek() === '/') {
        this.index++;
        exponent /= Number(this.tokens[this.index++]);
      }
      if (grouped && this.tokens[this.index++] !== ')') return null;
      if (!value || !Number.isFinite(exponent)) return null;
      value = {
        dimensions: value.dimensions.map(item => item * exponent) as Dimensions,
        targetPower: value.targetPower * exponent
      };
    }
    return value;
  }

  private primary(): DimensionExpression | null {
    const token = this.tokens[this.index++];
    if (!token) return null;
    if (token === '+' || token === '-') return this.primary();
    if (token === '(') {
      const value = this.sum();
      if (this.tokens[this.index++] !== ')') return null;
      return value;
    }
    if (/^(?:\d|\.\d)/.test(token) || token === 'pi' || token === 'e') return { dimensions: zero(), targetPower: 0 };
    if (/^(sin|cos|tan|log|ln|exp)$/.test(token) && this.peek() === '(') {
      this.index++;
      const argument = this.sum();
      if (this.tokens[this.index++] !== ')') return null;
      if (!argument) return null;
      this.constraints.push([argument, { dimensions: zero(), targetPower: 0 }]);
      return { dimensions: zero(), targetPower: 0 };
    }
    if (token === 'abs' && this.peek() === '(') {
      this.index++;
      const argument = this.sum();
      if (this.tokens[this.index++] !== ')') return null;
      return argument;
    }
    if (token === this.targetName) return { dimensions: zero(), targetPower: 1 };
    const known = this.units.get(token);
    return known ? { dimensions: known.dimensions, targetPower: 0 } : null;
  }

  private peek(): string | undefined { return this.tokens[this.index]; }
}

/** Infer an SI output unit for equations written as `unknown = expression` (or the reverse). */
export function inferEquationUnit(latex: string, variableName: string, knownUnits: Map<string, string>): string {
  const equation = normalizeLatexExpression(latex).split('=');
  if (equation.length !== 2) return '';
  const units = new Map<string, UnitValue>();
  knownUnits.forEach((unitText, name) => {
    const parsed = parseUnit(unitText);
    if (parsed) units.set(name, parsed);
  });
  units.delete(variableName);

  const tokenize = (expression: string): string[] => {
    const tokens = expression.match(/[A-Za-z][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()+\-*/^]/g) || [];
    return tokens.join('') === expression ? tokens : [];
  };
  const leftParser = new DimensionExpressionParser(tokenize(equation[0]), units, variableName);
  const rightParser = new DimensionExpressionParser(tokenize(equation[1]), units, variableName);
  const left = leftParser.parse(), right = rightParser.parse();
  if (!left || !right) return '';

  const constraints: Array<[DimensionExpression, DimensionExpression]> = [
    ...leftParser.constraints,
    ...rightParser.constraints,
    [left, right]
  ];
  let inferred: Dimensions | null = null;
  for (const [first, second] of constraints) {
    const coefficient = first.targetPower - second.targetPower;
    if (Math.abs(coefficient) < 1e-12) {
      if (!first.dimensions.every((value, index) => Math.abs(value - second.dimensions[index]) < 1e-9)) return '';
      continue;
    }
    const candidate = first.dimensions.map((value, index) =>
      (second.dimensions[index] - value) / coefficient) as Dimensions;
    if (inferred && !candidate.every((value, index) => Math.abs(value - inferred![index]) < 1e-9)) return '';
    inferred = candidate;
  }
  if (!inferred || inferred.some(power => !Number.isFinite(power))) return '';
  return formatDimensions(inferred.map(power => Math.abs(power) < 1e-9 ? 0 : power) as Dimensions);
}
