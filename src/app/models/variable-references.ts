import { Cell, EquationCell } from './cell.model';

const GREEK = new Set('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' '));

/** Extract canonical names without treating x as a reference to x_0 or xy. */
export function equationIdentifiers(latex: string): Set<string> {
  let source = latex;
  for (let pass = 0; pass < 3; pass++) {
    source = source.replace(/\\(?:operatorname|mathrm|mathit|text)\s*\{([^{}]*)\}/g, '$1');
  }
  source = source.replace(/\\([A-Za-z]+)/g, (_whole, command: string) =>
    GREEK.has(command) ? command : ' ');
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

export function cellUsesVariable(cell: Cell, name: string): boolean {
  if (cell.type === 'equation') return equationIdentifiers(cell.latex).has(name);
  if (cell.type === 'code') return codeIdentifiers(cell.source).has(name);
  return false;
}

export function cellProducesVariable(cell: Cell, name: string): boolean {
  if (cell.type === 'code') return cell.outputs.some(output => output.name === name);
  if (cell.type !== 'equation') return false;
  const equation = cell as EquationCell;
  const left = equation.latex.split('=')[0] || '';
  if (equationIdentifiers(left).has(name)) return true;
  return (equation.solutions || []).some(solution => equationIdentifiers(solution.split('=')[0] || '').has(name));
}
