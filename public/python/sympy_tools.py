"""
SymPy Tools for Alpha Solve

Provides utility functions for working with SymPy in Alpha Solve plugins.
This module is automatically loaded when a plugin uses the 'sympy' library.
"""

import re
from sympy import sympify, symbols, Eq, sqrt, sin, cos, tan, ln, log, exp, pi, E, Derivative, Integral, Symbol
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application


def from_latex(latex_str: str):
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

    # Convert LaTeX to Python-like expression
    expr_str = _latex_to_sympy_str(latex_str)

    # Check if it's an equation (contains =)
    if '=' in expr_str:
        parts = expr_str.split('=', 1)
        left = parse_expr(parts[0], transformations=(standard_transformations + (implicit_multiplication_application,)))
        right = parse_expr(parts[1], transformations=(standard_transformations + (implicit_multiplication_application,)))
        return Eq(left, right)
    else:
        return parse_expr(expr_str, transformations=(standard_transformations + (implicit_multiplication_application,)))


def _handle_derivatives(latex: str) -> str:
    """
    Handle derivative notation (primes) in LaTeX.
    Converts x', x'', x''' etc. to Derivative(x, t, n) where n is the number of primes.
    """
    # Match variable names followed by one or more primes
    # Pattern: variable name (letters/numbers) followed by one or more '
    pattern = r"([a-zA-Z][a-zA-Z0-9]*)('+)"

    def replace_prime(match):
        var_name = match.group(1)
        primes = match.group(2)
        num_primes = len(primes)

        if num_primes == 1:
            return f"Derivative({var_name}, t)"
        else:
            return f"Derivative({var_name}, t, {num_primes})"

    return re.sub(pattern, replace_prime, latex)


def _handle_integrals(latex: str) -> str:
    """
    Handle integral notation in LaTeX.
    Converts:
    - \int_a^b f(x) dx -> Integral(f(x), (x, a, b))
    - \int f(x) dx -> Integral(f(x), x)
    - ∫ (unicode) also supported
    """
    # Replace unicode integral symbol with \int
    latex = latex.replace('∫', r'\int')

    # Pattern for definite integral: \int_{lower}^{upper} ... d{var}
    # This is complex because the integrand can contain nested expressions
    # We'll use a simpler approach: find \int, find the d{var} at the end, extract everything

    # First, handle definite integrals: \int_a^b or \int_{a}^{b}
    definite_pattern = r'\\int_\{?([^{}^]+)\}?\^\{?([^{}]+)\}?\s*(.*?)\s*d([a-zA-Z])'

    def replace_definite(match):
        lower = match.group(1).strip()
        upper = match.group(2).strip()
        integrand = match.group(3).strip()
        var = match.group(4)
        return f"Integral({integrand}, ({var}, {lower}, {upper}))"

    latex = re.sub(definite_pattern, replace_definite, latex)

    # Then handle indefinite integrals: \int ... dx
    indefinite_pattern = r'\\int\s+(.*?)\s*d([a-zA-Z])'

    def replace_indefinite(match):
        integrand = match.group(1).strip()
        var = match.group(2)
        return f"Integral({integrand}, {var})"

    latex = re.sub(indefinite_pattern, replace_indefinite, latex)

    return latex


def _latex_to_sympy_str(latex: str) -> str:
    """
    Convert LaTeX math notation to a SymPy-parseable string.
    """
    # Handle integrals before other transformations
    latex = _handle_integrals(latex)

    # Handle derivatives (prime notation) before other transformations
    latex = _handle_derivatives(latex)

    # Remove \left, \right, and other formatting commands
    latex = re.sub(r'\\left|\\right', '', latex)

    # Handle subscripts with braces first: x_{11} -> x_11, v_{\alpha} -> v_\alpha
    latex = re.sub(r'_\{([^{}]*)\}', r'_\1', latex)

    # Handle common Greek letters specifically (before fractions)
    # This way v_\alpha becomes v_alpha before we process fractions
    greek_letters = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
                     'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho',
                     'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']
    for letter in greek_letters:
        latex = latex.replace(f'\\{letter}', letter)

    # Add implicit multiplication between variables/numbers and Greek letters
    # e.g., falpha -> f*alpha, 2beta -> 2*beta
    for letter in greek_letters:
        latex = re.sub(rf'([a-zA-Z0-9_])({letter})', rf'\1*\2', latex)

    # Replace square roots BEFORE fractions: \sqrt{x} -> sqrt(x)
    # This way \sqrt{2} becomes sqrt(2) before we process fractions
    latex = re.sub(r'\\sqrt\{([^{}]*)\}', r'sqrt(\1)', latex)

    # Add implicit multiplication between variables/numbers and sqrt
    # e.g., asqrt(2) -> a*sqrt(2), 2sqrt(3) -> 2*sqrt(3)
    latex = re.sub(r'([a-zA-Z0-9_])sqrt\(', r'\1*sqrt(', latex)

    # Replace fractions: \frac{a}{b} -> (a)/(b)
    # Now that subscripts, Greek letters, and square roots are simplified, this will work
    # Limit iterations to prevent infinite loops
    for _ in range(100):
        if r'\frac' not in latex:
            break
        latex = re.sub(r'\\frac\{([^{}]*)\}\{([^{}]*)\}', r'((\1)/(\2))', latex)

    # Replace exponents: ^ -> **
    latex = latex.replace('^', '**')

    # Handle exponents with braces: x**{2} -> x**2
    latex = re.sub(r'\*\*\{([^{}]*)\}', r'**(\1)', latex)

    # Handle \cdot as multiplication
    latex = latex.replace(r'\cdot', '*')
    latex = latex.replace(r'\times', '*')

    # Handle common functions
    latex = re.sub(r'\\sin', 'sin', latex)
    latex = re.sub(r'\\cos', 'cos', latex)
    latex = re.sub(r'\\tan', 'tan', latex)
    latex = re.sub(r'\\ln', 'ln', latex)
    latex = re.sub(r'\\log', 'log', latex)
    latex = re.sub(r'\\exp', 'exp', latex)

    # Handle constants (pi was already handled with Greek letters)
    latex = latex.replace('π', 'pi')
    latex = re.sub(r'\\e\b', 'E', latex)

    # Remove remaining backslashes for any other cases
    latex = re.sub(r'\\([a-zA-Z]+)', r'\1', latex)

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

