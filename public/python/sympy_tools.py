"""
SymPy Tools for Alpha Solve

Provides utility functions for working with SymPy in Alpha Solve plugins.
This module is automatically loaded when a plugin uses the 'sympy' library.
"""

import re
from sympy import sympify, symbols, Eq, sqrt, sin, cos, tan, ln, log, exp, pi, E, Derivative, Integral, Symbol, Function, real_root, root
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application


def from_latex(latex_str: str, evaluate=True):
    """
    Convert a LaTeX string to a SymPy expression.
    Custom parser that handles common LaTeX math notation without antlr4.

    Args:
        latex_str: LaTeX string representing a mathematical expression

    Returns:
        SymPy expression

    Example:
        >>> expr = from_latex(r"x^2 + 2x + 1")
        >>> expr
        x**2 + 2*x + 1
    """
    if not latex_str or not latex_str.strip():
        raise ValueError("Empty LaTeX string")

    # Remove extra whitespace
    latex_str = latex_str.strip()

    # Preserve named variables emitted by MathQuill rather than splitting
    # e.g. "mass" into m*a*s*s during implicit multiplication parsing.
    named_variables = re.findall(r'\\(?:operatorname|mathrm)\{([A-Za-z][A-Za-z0-9_]*)\}', latex_str)
    local_dict = {name: Symbol(name) for name in named_variables}
    latex_str = re.sub(r'\\(?:operatorname|mathrm)\{([A-Za-z][A-Za-z0-9_]*)\}', r'\1', latex_str)
    # Convert LaTeX to Python-like expression
    expr_str = _latex_to_sympy_str(latex_str)
    # Every non-function identifier is a single engineering symbol. This makes
    # TMR, mass, sigma_max, and x_0 unambiguous. Multiplication must be explicit
    # (x\cdot y), so "xy" intentionally means the variable named xy.
    reserved_names = {
        'sqrt', 'sin', 'cos', 'tan', 'ln', 'log', 'exp',
        'Derivative', 'Integral', 'Eq', 'pi', 'True', 'False',
        'Abs', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'engineering_root', 'EulerConstant', 'oo'
    }
    local_dict.update({'engineering_root': _engineering_root, 'EulerConstant': E})
    for name in re.findall(r'\b([A-Za-z][A-Za-z0-9_]*)\(', expr_str):
        if name not in reserved_names:
            local_dict[name] = Function(name)
    for name in re.findall(r'\b[A-Za-z][A-Za-z0-9_]*\b', expr_str):
        if name not in reserved_names:
            local_dict.setdefault(name, Symbol(name))

    # Check if it's an equation (contains =)
    if expr_str.count('=') > 1:
        raise ValueError('Use one equals sign per equation.')
    if '=' in expr_str:
        parts = expr_str.split('=', 1)
        left = parse_expr(parts[0], local_dict=local_dict, transformations=(standard_transformations + (implicit_multiplication_application,)), evaluate=evaluate)
        right = parse_expr(parts[1], local_dict=local_dict, transformations=(standard_transformations + (implicit_multiplication_application,)), evaluate=evaluate)
        return Eq(left, right, evaluate=False)
    else:
        return parse_expr(expr_str, local_dict=local_dict, transformations=(standard_transformations + (implicit_multiplication_application,)), evaluate=evaluate)


def _engineering_root(value, degree):
    """Indexed odd roots of real inputs use the real branch; square roots are principal."""
    degree = sympify(degree)
    if not degree.is_Integer or degree <= 0:
        raise ValueError('A root index must be a positive integer.')
    return real_root(value, degree) if degree % 2 else root(value, degree)


def _group(text, start, opening='{', closing='}'):
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] != opening:
        raise ValueError('Expected a grouped argument.')
    depth = 1
    for end in range(start + 1, len(text)):
        if text[end] == opening:
            depth += 1
        elif text[end] == closing:
            depth -= 1
            if depth == 0:
                return text[start + 1:end], end + 1
    raise ValueError('Unclosed mathematical group.')


def _expand_roots_and_fractions(text):
    """Read balanced groups, so radicals and fractions may nest in either order."""
    match = re.search(r'\\(frac|dfrac|tfrac|sqrt)(?![A-Za-z])', text)
    if not match:
        return text
    position = match.end()
    if match.group(1) == 'sqrt':
        while position < len(text) and text[position].isspace():
            position += 1
        degree = None
        if position < len(text) and text[position] == '[':
            degree, position = _group(text, position, '[', ']')
        body, end = _group(text, position)
        body = _expand_roots_and_fractions(body)
        replacement = 'sqrt(%s)' % body if degree is None else 'engineering_root((%s),(%s))' % (body, degree)
    else:
        numerator, position = _group(text, position)
        denominator, end = _group(text, position)
        differential = re.fullmatch(r'd(?:\^\{?(\d+)\}?)?([A-Za-z])', numerator.strip())
        independent = re.fullmatch(r'd([A-Za-z])(?:\^\{?(\d+)\}?)?', denominator.strip())
        if differential and independent:
            order = int(differential.group(1) or 1)
            if order != int(independent.group(2) or 1):
                raise ValueError('Derivative orders in numerator and denominator must match.')
            name, variable = differential.group(2), independent.group(1)
            replacement = ('Derivative(%s,%s,%d)' % (name, variable, order) if name == variable
                           else 'Derivative(%s(%s),%s,%d)' % (name, variable, variable, order))
        else:
            replacement = '((%s)/(%s))' % (_expand_roots_and_fractions(numerator), _expand_roots_and_fractions(denominator))
    # Spaces keep generated function names separate from preceding LaTeX
    # commands. Otherwise \cdot\sqrt became \cdotsqrt, and inserting '*' in
    # front of sqrt then changed multiplication to Python exponentiation '**'.
    return text[:match.start()] + ' ' + replacement + ' ' + _expand_roots_and_fractions(text[end:])


def _handle_derivatives(latex: str) -> str:
    """
    Handle derivative notation (primes) in LaTeX.
    Converts x', x'', x''' etc. to Derivative(x, t, n) where n is the number of primes.
    """
    # Match variable names followed by one or more primes
    # Pattern: variable name (letters/numbers) followed by one or more '
    pattern = r"([a-zA-Z][a-zA-Z0-9_]*)(\'+)"

    def replace_prime(match):
        var_name = match.group(1)
        primes = match.group(2)
        num_primes = len(primes)

        if num_primes == 1:
            return f"Derivative({var_name}(t), t)"
        else:
            return f"Derivative({var_name}(t), t, {num_primes})"

    names = {match.group(1) for match in re.finditer(pattern, latex)}
    latex = re.sub(pattern, replace_prime, latex)
    for name in names:
        latex = re.sub(r'\b' + re.escape(name) + r'\b(?!\s*\()', name + '(t)', latex)
    return latex


def _handle_integrals(latex: str) -> str:
    r"""
    Handle integral notation in LaTeX.
    Converts:
    - \int_a^b f(x) dx -> Integral(f(x), (x, a, b))
    - \int f(x) dx -> Integral(f(x), x)
    - ∫ (unicode) also supported
    """
    latex = latex.replace('∫', r'\int')
    while True:
        match = re.search(r'\\int(?![A-Za-z])', latex)
        if not match:
            break
        position = match.end()
        bounds = {}
        while position < len(latex) and latex[position].isspace():
            position += 1
        while position < len(latex) and latex[position] in '_^':
            kind = latex[position]
            position += 1
            if position < len(latex) and latex[position] == '{':
                bounds[kind], position = _group(latex, position)
            elif position < len(latex):
                bounds[kind], position = latex[position], position + 1
            else:
                raise ValueError('Missing integral bound.')
        if bounds and set(bounds) != {'_', '^'}:
            raise ValueError('A definite integral needs both bounds.')
        differential = re.search(r'd\s*([A-Za-z])(?![A-Za-z0-9_])', latex[position:])
        if not differential:
            raise ValueError('An integral needs an explicit differential such as dx.')
        body = latex[position:position + differential.start()].strip()
        if not body or r'\int' in body:
            raise ValueError('Use one complete integral at a time.')
        variable = differential.group(1)
        limit = '(%s,%s,%s)' % (variable, bounds['_'], bounds['^']) if bounds else variable
        end = position + differential.end()
        latex = latex[:match.start()] + 'Integral(%s,%s)' % (body, limit) + latex[end:]
    return latex


def _latex_to_sympy_str(latex: str) -> str:
    """
    Convert LaTeX math notation to a SymPy-parseable string.
    """
    latex = _expand_roots_and_fractions(latex)
    for name, variable in re.findall(r'Derivative\(([A-Za-z])\(([A-Za-z])\)', latex):
        latex = re.sub(r'\b' + name + r'\b(?!\s*\()', name + '(' + variable + ')', latex)
    # Handle integrals before other transformations
    latex = _handle_integrals(latex)

    # Remove \left, \right, and other formatting commands
    latex = re.sub(r'\\left|\\right', '', latex)
    # MathQuill may emit square grouping brackets; SymPy needs parentheses.
    latex = latex.replace('[', '(').replace(']', ')')

    # Handle subscripts with braces first: x_{11} -> x_11, v_{\alpha} -> v_\alpha
    latex = re.sub(r'_\{([^{}]*)\}', r'_\1', latex)

    # Handle common Greek letters specifically (before fractions)
    # This way v_\alpha becomes v_alpha before we process fractions
    greek_letters = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
                     'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho',
                     'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
                     'varepsilon', 'vartheta', 'varpi', 'varrho', 'varsigma', 'varphi',
                     'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']
    for letter in greek_letters:
        latex = re.sub(r'\\' + letter + r'(?![A-Za-z])', letter, latex)
    latex = _handle_derivatives(latex)

    # Replace exponents: ^ -> **
    latex = latex.replace('^', '**')

    # Handle exponents with braces: x**{2} -> x**2
    latex = re.sub(r'\*\*\{([^{}]*)\}', r'**(\1)', latex)

    # Handle \cdot as multiplication
    latex = latex.replace(r'\cdot', '*')
    latex = latex.replace(r'\times', '*')

    # Handle common functions
    for function in ('sin', 'cos', 'tan', 'ln', 'log', 'exp', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan'):
        latex = re.sub(r'\\' + function + r'(?![A-Za-z])', function.replace('arc', 'a'), latex)

    # Handle constants (pi was already handled with Greek letters)
    latex = latex.replace('π', 'pi')
    latex = re.sub(r'\\e\b', 'EulerConstant', latex)
    latex = re.sub(r'\\infty\b', 'oo', latex)

    latex = re.sub(r'\\[,;:! ]', ' ', latex)
    if '\\' in latex:
        raise ValueError('Unsupported LaTeX command; the expression was not evaluated.')
    latex = re.sub(r'\|([^|]+)\|', r'Abs(\1)', latex)
    latex = latex.replace('{', '(').replace('}', ')')

    # Clean up spaces
    latex = latex.strip()

    return latex


def to_latex(expr):
    """
    Convert a SymPy expression to LaTeX string.

    Args:
        expr: SymPy expression

    Returns:
        LaTeX string representation

    Example:
        >>> from sympy import symbols
        >>> x = symbols('x')
        >>> expr = x**2 + 2*x + 1
        >>> to_latex(expr)
        'x^{2} + 2 x + 1'
    """
    from sympy import latex
    return latex(expr)
