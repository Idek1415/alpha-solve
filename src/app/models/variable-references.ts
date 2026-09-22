import { Cell, EquationCell } from './cell.model';

const GREEK = new Set('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' '));
const GREEK_UNICODE: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ϵ: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ϑ: 'theta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ϖ: 'pi', ρ: 'rho', ϱ: 'rho',
  σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', ϕ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega'
};
const GREEK_VARIANTS: Record<string, string> = {
  varepsilon: 'epsilon', vartheta: 'theta', varpi: 'pi', varrho: 'rho', varsigma: 'sigma', varphi: 'phi'
};
const GREEK_COMMANDS = [...GREEK, ...Object.keys(GREEK_VARIANTS)].sort((left, right) => right.length - left.length);
const COMPOSITE_GREEK = new RegExp(
  `\\\\(${GREEK_COMMANDS.join('|')})\\s*([A-Za-z][A-Za-z0-9]*(?:_\\{[^{}]+\\}|_[A-Za-z0-9]+)?)`,
  'g'
);

/** In Alpha Solve, adjacent letters form one engineering identifier; multiplication is explicit. */
export function normalizeCompositeGreekLatex(latex: string): string {
  return latex.replace(COMPOSITE_GREEK, (_whole, greek: string, suffix: string) =>
    `${GREEK_VARIANTS[greek] || greek}${suffix}`);
}

export function canonicalVariableName(latex: string): string {
  let name = normalizeCompositeGreekLatex(latex).trim();
  for (const [symbol, canonical] of Object.entries(GREEK_UNICODE)) name = name.replaceAll(symbol, canonical);
  name = name
    .replace(/\\operatorname\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:mathrm|mathit)\{([^{}]+)\}/g, '$1')
    .replace(/_\{([^{}]*)\}/g, '_$1')
    .replace(/\\([A-Za-z]+)/g, (_whole, command: string) => GREEK_VARIANTS[command] || command)
    .replace(/[{}\s]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) ? name : '';
}

/** Extract canonical names without treating x as a reference to x_0 or xy. */
export function equationIdentifiers(latex: string): Set<string> {
  let source = normalizeCompositeGreekLatex(latex);
  for (const [symbol, canonical] of Object.entries(GREEK_UNICODE)) source = source.replaceAll(symbol, canonical);
  for (let pass = 0; pass < 3; pass++) {
    source = source.replace(/\\(?:operatorname|mathrm|mathit|text)\s*\{([^{}]*)\}/g, '$1');
  }
  source = source.replace(/\\([A-Za-z]+)/g, (_whole, command: string) =>
    GREEK.has(command) ? command : GREEK_VARIANTS[command] || ' ');
  source = source.replace(/_\{([A-Za-z0-9_]+)\}/g, '_$1');
  return new Set(source.match(/[A-Za-z][A-Za-z0-9_]*/g) || []);
}

/** Ignore comments and quoted strings, including dictionary output keys. */
export function codeIdentifiers(source: string): Set<string> {
  const withoutStrings = source
    .replace(/(?:'''[\s\S]*?'''|"""[\s\S]*?""")/g, ' ')
    .replace(/(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g, ' ')
    .replace(/#[^\r\n]*/g, ' ');
  return new Set(withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
}

export function codeFunctionArguments(source: string): Set<string> {
  const match = source.match(/^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/m);
  if (!match) return new Set();
  return new Set(match[1].split(',').map(argument => argument.trim().split(/[:=]/)[0].trim())
    .filter(argument => /^[A-Za-z_][A-Za-z0-9_]*$/.test(argument) && argument !== 'self'));
}

export function codeDeclaredOutputs(cell: Cell): Set<string> {
  if (cell.type !== 'code') return new Set();
  const names = new Set(cell.outputs.map(output => output.name));
  const returnDictionary = cell.source.match(/\breturn\s*\{([\s\S]*?)\}/m)?.[1] || '';
  for (const match of returnDictionary.matchAll(/(?:^|,)\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]\s*:/g)) names.add(match[1]);
  return names;
}

export function cellUsesVariable(cell: Cell, name: string): boolean {
  if (cell.type === 'equation') return equationIdentifiers(cell.latex).has(name);
  if (cell.type === 'code') return codeIdentifiers(cell.source).has(name);
  return false;
}

export function cellProducesVariable(cell: Cell, name: string): boolean {
  if (cell.type === 'code') return codeDeclaredOutputs(cell).has(name);
  if (cell.type !== 'equation') return false;
  const equation = cell as EquationCell;
  const left = equation.latex.split('=')[0] || '';
  if (equationIdentifiers(left).has(name)) return true;
  return (equation.solutions || []).some(solution => equationIdentifiers(solution.split('=')[0] || '').has(name));
}
