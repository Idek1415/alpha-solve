# Proc Macros

Proc macros (procedural macros) transform LaTeX **before** it reaches [cell functions](cell-functions.md). They enable powerful preprocessing like evaluating integrals, expanding notation, or substituting values.

## Overview

Proc macros:
- Receive `ProcMacroInput` with LaTeX and context
- Transform or modify the LaTeX string
- Return `ProcMacroResult` with the modified LaTeX
- Must have a corresponding meta function
- Run before cell functions see the input

## Why Proc Macros?

Proc macros enable:
- **Evaluation**: Compute integrals, derivatives before solving
- **Expansion**: Replace custom notation with standard forms
- **Substitution**: Insert context variable values into expressions
- **Preprocessing**: Transform LaTeX into forms cell functions can handle better

### Example Use Case

Without proc macro:
```
Input: \int_{0}^{2} x^2 dx
Cell function sees: \int_{0}^{2} x^2 dx
```

With proc macro:
```
Input: \int_{0}^{2} x^2 dx
Proc macro evaluates: 8/3
Cell function sees: 8/3
```

## Function Signature

### Proc Macro

```python
from alpha_solve import ProcMacroInput, ProcMacroResult

def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    """
    Transform LaTeX before cell functions process it.

    Args:
        input_data: Contains latex string and context

    Returns:
        Result with modified LaTeX
    """
    pass
```

### Meta Function (Required)

```python
from alpha_solve import ProcMacroInput, MetaFunctionResult

def meta_my_macro(input_data: ProcMacroInput) -> MetaFunctionResult:
    """
    Determine if this macro should run.

    Args:
        input_data: Contains latex string and context

    Returns:
        Result indicating whether to use this macro
    """
    pass
```

## Manifest Declaration

Proc macros must be declared in `manifest.toml`:

```toml
[[proc_macros]]
functionName = "my_macro"              # The macro function name
metaFunctionName = "meta_my_macro"     # The meta function name
```

## Input Structure

### Accessing LaTeX

```python
def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    # Get the LaTeX string
    latex = input_data.latex

    print(f"Original LaTeX: {latex}")
```

### Accessing Context

```python
def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    # Access context variables
    for var in input_data.context.variables:
        print(f"{var.name} = {var.values}")

    # Get specific variable
    x_var = input_data.context.get_variable('x')
    if x_var:
        print(f"x = {x_var.values}")
```

## Return Structure

Always return the modified (or original) LaTeX:

```python
from alpha_solve import ProcMacroResult

# If transformation succeeded
return ProcMacroResult(modified_latex=new_latex)

# If transformation failed or not needed
return ProcMacroResult(modified_latex=input_data.latex)
```

## Complete Examples

### Example 1: Evaluate Definite Integrals

```python
import re
from alpha_solve import ProcMacroInput, ProcMacroResult, MetaFunctionResult
from sympy_tools import from_latex, to_latex
from sympy import integrate, symbols, sympify

def evaluate_integrals(input_data: ProcMacroInput) -> ProcMacroResult:
    """
    Evaluate definite integrals in LaTeX.
    Pattern: \int_{lower}^{upper}\left(integrand\right)dvar
    """
    modified_latex = input_data.latex

    # Pattern matches: \int_{a}^{b}\left(expr\right)dx
    # Also handles without braces: \int_a^b\left(expr\right)dx
    pattern = r'\\int_(?:\{([^}]+)\}|([^\s\^\\]+))\^(?:\{([^}]+)\}|([^\s\\]+))\\left\((.*?)\\right\)d([a-zA-Z])'

    match = re.search(pattern, modified_latex)
    if not match:
        return ProcMacroResult(modified_latex=modified_latex)

    try:
        # Extract components
        lower_bound = (match.group(1) or match.group(2) or '').strip()
        upper_bound = (match.group(3) or match.group(4) or '').strip()
        integrand_latex = match.group(5).strip()
        var = match.group(6)

        # Skip if incomplete
        if not lower_bound or not upper_bound or not integrand_latex:
            return ProcMacroResult(modified_latex=modified_latex)

        # Parse bounds
        try:
            lower_sym = from_latex(lower_bound)
        except:
            lower_sym = symbols(lower_bound)

        try:
            upper_sym = from_latex(upper_bound)
        except:
            upper_sym = symbols(upper_bound)

        # Substitute context variables in bounds
        for context_var in input_data.context.variables:
            try:
                var_sym = symbols(context_var.name)
                value = sympify(context_var.values[0])
                lower_sym = lower_sym.subs(var_sym, value)
                upper_sym = upper_sym.subs(var_sym, value)
            except:
                pass

        # Parse integrand
        integrand = from_latex(integrand_latex)
        var_symbol = symbols(var)

        # Substitute context variables in integrand (except integration variable)
        for context_var in input_data.context.variables:
            if context_var.name != var and context_var.values:
                try:
                    var_sym = symbols(context_var.name)
                    value = sympify(context_var.values[0])
                    integrand = integrand.subs(var_sym, value)
                except:
                    pass

        # Evaluate the integral
        result = integrate(integrand, (var_symbol, lower_sym, upper_sym))

        # Simplify
        from sympy import simplify
        result = simplify(result)

        # Convert to LaTeX
        result_latex = to_latex(result)

        # Replace integral with result
        modified_latex = modified_latex[:match.start()] + result_latex + modified_latex[match.end():]

        print(f"Evaluated integral: {match.group(0)} -> {result_latex}")

        return ProcMacroResult(modified_latex=modified_latex)

    except Exception as e:
        print(f"Failed to evaluate integral: {e}")
        return ProcMacroResult(modified_latex=modified_latex)


def meta_evaluate_integrals(input_data: ProcMacroInput) -> MetaFunctionResult:
    """Check if LaTeX contains definite integrals."""
    # Pattern handles both \int_{x}^{y} and \int_x^y
    pattern = r'\\int_(?:\{[^}]+\}|[^\s\^\\]+)\^(?:\{[^}]+\}|[^\s\\]+)\\left\(.+?\\right\)d[a-zA-Z]'
    has_integral = bool(re.search(pattern, input_data.latex))

    return MetaFunctionResult(
        index=3,  # Run early, before other macros
        name="Evaluate Integrals",
        use_result=has_integral
    )
```

### Example 2: Substitute Context Variables

```python
import re
from alpha_solve import ProcMacroInput, ProcMacroResult, MetaFunctionResult
from sympy import symbols, sympify
from sympy_tools import from_latex, to_latex

def substitute_variables(input_data: ProcMacroInput) -> ProcMacroResult:
    """
    Substitute context variable values into expressions.
    Only substitutes if variable is marked for substitution (e.g., with @x notation).
    """
    modified_latex = input_data.latex

    # Pattern: @variable_name
    pattern = r'@([a-zA-Z][a-zA-Z0-9_]*)'

    matches = re.findall(pattern, modified_latex)
    if not matches:
        return ProcMacroResult(modified_latex=modified_latex)

    try:
        # Parse the expression
        # First, remove @ symbols temporarily to parse
        temp_latex = re.sub(pattern, r'\1', modified_latex)
        expr = from_latex(temp_latex)

        # Substitute each marked variable
        for var_name in matches:
            context_var = input_data.context.get_variable(var_name)
            if context_var and context_var.values:
                var_sym = symbols(var_name)
                value = sympify(context_var.values[0])
                expr = expr.subs(var_sym, value)

        # Convert back to LaTeX
        modified_latex = to_latex(expr)

        return ProcMacroResult(modified_latex=modified_latex)

    except Exception as e:
        print(f"Failed to substitute variables: {e}")
        return ProcMacroResult(modified_latex=input_data.latex)


def meta_substitute_variables(input_data: ProcMacroInput) -> MetaFunctionResult:
    """Check if LaTeX contains @variable markers."""
    has_marker = '@' in input_data.latex and bool(re.search(r'@[a-zA-Z]', input_data.latex))

    return MetaFunctionResult(
        index=1,  # Run very early
        name="Substitute Variables",
        use_result=has_marker
    )
```

### Example 3: Expand Custom Notation

```python
import re
from alpha_solve import ProcMacroInput, ProcMacroResult, MetaFunctionResult

def expand_notation(input_data: ProcMacroInput) -> ProcMacroResult:
    """
    Expand custom notation into standard LaTeX.
    Example: vec{x} -> \mathbf{x}, norm{x} -> ||x||
    """
    modified_latex = input_data.latex

    try:
        # Expand vec{} to \mathbf{}
        modified_latex = re.sub(r'vec\{([^}]+)\}', r'\\mathbf{\1}', modified_latex)

        # Expand norm{} to ||...||
        modified_latex = re.sub(r'norm\{([^}]+)\}', r'||\1||', modified_latex)

        # Expand dot{x} to x with dot above
        modified_latex = re.sub(r'dot\{([^}]+)\}', r'\\dot{\1}', modified_latex)

        return ProcMacroResult(modified_latex=modified_latex)

    except Exception as e:
        print(f"Failed to expand notation: {e}")
        return ProcMacroResult(modified_latex=input_data.latex)


def meta_expand_notation(input_data: ProcMacroInput) -> MetaFunctionResult:
    """Check if LaTeX contains custom notation."""
    has_custom = any(
        pattern in input_data.latex
        for pattern in ['vec{', 'norm{', 'dot{']
    )

    return MetaFunctionResult(
        index=1,
        name="Expand Notation",
        use_result=has_custom
    )
```

### Example 4: Numerical Evaluation Macro

```python
import re
from alpha_solve import ProcMacroInput, ProcMacroResult, MetaFunctionResult
from sympy_tools import from_latex
from sympy import sympify, N

def evaluate_num_functions(input_data: ProcMacroInput) -> ProcMacroResult:
    """
    Evaluate num() functions to get numerical values.
    Example: num(pi) -> 3.14159..., num(sqrt(2)) -> 1.41421...
    """
    modified_latex = input_data.latex

    # Pattern: num(expression)
    pattern = r'num\(([^)]+)\)'

    match = re.search(pattern, modified_latex)
    if not match:
        return ProcMacroResult(modified_latex=modified_latex)

    try:
        expr_latex = match.group(1)

        # Parse the expression
        expr = from_latex(expr_latex)

        # Substitute context variables
        for context_var in input_data.context.variables:
            if context_var.values:
                try:
                    from sympy import symbols
                    var_sym = symbols(context_var.name)
                    value = sympify(context_var.values[0])
                    expr = expr.subs(var_sym, value)
                except:
                    pass

        # Evaluate numerically
        result = N(expr, 10)  # 10 significant figures

        # Replace num() with result
        result_str = str(result)
        modified_latex = modified_latex[:match.start()] + result_str + modified_latex[match.end():]

        print(f"Evaluated num(): {match.group(0)} -> {result_str}")

        return ProcMacroResult(modified_latex=modified_latex)

    except Exception as e:
        print(f"Failed to evaluate num(): {e}")
        return ProcMacroResult(modified_latex=input_data.latex)


def meta_evaluate_num_functions(input_data: ProcMacroInput) -> MetaFunctionResult:
    """Check if LaTeX contains num() functions."""
    has_num = 'num(' in input_data.latex

    return MetaFunctionResult(
        index=5,
        name="Evaluate num()",
        use_result=has_num
    )
```

## Working with Regular Expressions

### Common LaTeX Patterns

```python
import re

# Integral: \int_{a}^{b} ... dx
integral_pattern = r'\\int_\{([^}]+)\}\^\{([^}]+)\}(.*?)d([a-zA-Z])'

# Fraction: \frac{numerator}{denominator}
fraction_pattern = r'\\frac\{([^{}]*)\}\{([^{}]*)\}'

# Function call: \sin(x), \cos(x), etc.
function_pattern = r'\\(sin|cos|tan|ln|log|exp)\(([^)]+)\)'

# Square root: \sqrt{expression}
sqrt_pattern = r'\\sqrt\{([^}]+)\}'

# Subscript: x_{subscript}
subscript_pattern = r'([a-zA-Z])_\{([^}]+)\}'

# Superscript: x^{exponent}
superscript_pattern = r'([a-zA-Z])\^\{([^}]+)\}'
```

### Handling MathQuill Output

MathQuill (the LaTeX editor) may generate LaTeX slightly differently:

```python
# MathQuill uses \left and \right for parentheses
pattern = r'\\left\((.*?)\\right\)'

# Subscripts without braces for single chars: x_1 not x_{1}
pattern = r'([a-zA-Z])_([0-9a-zA-Z])'

# Pattern that handles both forms:
pattern = r'_(?:\{([^}]+)\}|([0-9a-zA-Z]))'
```

### Safe Regex Usage

```python
# Limit iterations to prevent infinite loops
max_iterations = 100
for i in range(max_iterations):
    match = re.search(pattern, latex)
    if not match:
        break
    # Process match
    latex = latex[:match.start()] + replacement + latex[match.end():]

# Always check if pattern exists first
if r'\frac' not in latex:
    # No fractions to process
    return ProcMacroResult(modified_latex=latex)
```

## Index Priority for Proc Macros

Proc macro index determines execution order. Lower runs first.

### Recommended Ranges

- **1-2**: Pre-processing (expand notation, handle @ symbols)
- **3-5**: Evaluation (integrals, derivatives, num() functions)
- **6-10**: Post-processing (cleanup, formatting)

### Example Priority Order

```python
# Run first: expand custom notation
meta_expand_notation -> index=1

# Run second: substitute marked variables
meta_substitute_variables -> index=2

# Run third: evaluate integrals
meta_evaluate_integrals -> index=3

# Run fourth: evaluate num() functions
meta_evaluate_num_functions -> index=5
```

## Best Practices

### 1. Always Return Modified LaTeX

Even if processing fails, return the original:

```python
def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    modified_latex = input_data.latex

    try:
        # Transform LaTeX
        modified_latex = transform(modified_latex)
    except Exception as e:
        print(f"Transform failed: {e}")
        # Return original on error

    return ProcMacroResult(modified_latex=modified_latex)
```

### 2. Handle Edge Cases

Check for incomplete or malformed patterns:

```python
match = re.search(pattern, latex)
if not match:
    return ProcMacroResult(modified_latex=latex)

# Extract components
lower_bound = match.group(1).strip()
upper_bound = match.group(2).strip()

# Check for empty components
if not lower_bound or not upper_bound:
    return ProcMacroResult(modified_latex=latex)
```

### 3. Use Try-Except for Parsing

LaTeX parsing can fail:

```python
try:
    expr = from_latex(latex_string)
except:
    # Parsing failed, use fallback
    expr = symbols(latex_string)
```

### 4. Test with MathQuill Output

Test your patterns with actual MathQuill-generated LaTeX:

```python
# MathQuill may generate:
# \int_0^1\left(x^2\right)dx    (no braces for single chars)
# \int_{10}^{20}\left(x\right)dx  (braces for multi-char)

# Pattern that handles both:
pattern = r'\\int_(?:\{([^}]+)\}|([^\s\^\\]+))\^(?:\{([^}]+)\}|([^\s\\]+))\\left\((.*?)\\right\)d([a-zA-Z])'
```

### 5. Limit Iterations

Prevent infinite loops when replacing patterns:

```python
max_iterations = 100
for _ in range(max_iterations):
    if pattern not in latex:
        break
    # Replace one occurrence
    latex = re.sub(pattern, replacement, latex, count=1)
```

### 6. Print Debug Information

Help users understand what transformations occurred:

```python
print(f"[my_macro] Original: {input_data.latex}")
print(f"[my_macro] Modified: {modified_latex}")
print(f"[my_macro] Replaced: {match.group(0)} -> {result}")
```

### 7. Keep Context in Mind

Use context variables appropriately:

```python
# Substitute context variables before evaluation
for context_var in input_data.context.variables:
    if context_var.values:
        var_sym = symbols(context_var.name)
        value = sympify(context_var.values[0])
        expr = expr.subs(var_sym, value)
```

### 8. Handle Multiple Matches

Process all occurrences, not just the first:

```python
# ✓ Good: Process all matches
while True:
    match = re.search(pattern, latex)
    if not match:
        break
    # Process and replace this match
    latex = latex[:match.start()] + replacement + latex[match.end():]

# ✗ Bad: Only processes first match
match = re.search(pattern, latex)
if match:
    latex = latex.replace(match.group(0), replacement)
```

## Common Patterns

### Pattern: Find and Replace

```python
import re

def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    latex = input_data.latex

    # Find pattern
    pattern = r'custom\{([^}]+)\}'
    match = re.search(pattern, latex)

    if match:
        content = match.group(1)
        # Transform content
        replacement = f'\\standard{{{content}}}'
        # Replace in original string
        latex = latex[:match.start()] + replacement + latex[match.end():]

    return ProcMacroResult(modified_latex=latex)
```

### Pattern: Parse, Transform, Convert Back

```python
from sympy_tools import from_latex, to_latex

def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    try:
        # Parse LaTeX to SymPy
        expr = from_latex(input_data.latex)

        # Transform expression
        transformed = transform(expr)

        # Convert back to LaTeX
        latex = to_latex(transformed)

        return ProcMacroResult(modified_latex=latex)
    except:
        return ProcMacroResult(modified_latex=input_data.latex)
```

### Pattern: Conditional Transformation

```python
def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    latex = input_data.latex

    # Only transform if condition met
    if should_transform(latex, input_data.context):
        latex = transform(latex)

    return ProcMacroResult(modified_latex=latex)
```

## Testing Proc Macros

### Test Cases

```python
# Test 1: Basic functionality
input_latex = r'\int_0^1\left(x\right)dx'
expected = r'\frac{1}{2}'

# Test 2: With context variables
context = Context(variables=[Variable.create_analytical('a', ['2'])])
input_latex = r'\int_0^a\left(x\right)dx'
expected = r'2'  # (a^2)/2 = 4/2 = 2

# Test 3: Edge case - empty integrand
input_latex = r'\int_0^1\left(\right)dx'
expected = input_latex  # Should return original

# Test 4: Multiple occurrences
input_latex = r'\int_0^1\left(x\right)dx + \int_1^2\left(x\right)dx'
expected = r'\frac{1}{2} + \frac{3}{2}'
```

### Manual Testing

```python
# Create test input
from alpha_solve import ProcMacroInput, Context, Variable

latex = r'\int_0^1\left(x^2\right)dx'
context = Context(variables=[])
input_data = ProcMacroInput(latex=latex, context=context)

# Run macro
result = evaluate_integrals(input_data)
print(f"Result: {result.modified_latex}")

# Run meta function
meta_result = meta_evaluate_integrals(input_data)
print(f"Should use: {meta_result.use_result}")
```

## Debugging

### Print Statements

```python
def my_macro(input_data: ProcMacroInput) -> ProcMacroResult:
    print(f"[my_macro] Input: {input_data.latex}")

    match = re.search(pattern, input_data.latex)
    if match:
        print(f"[my_macro] Match found: {match.group(0)}")
        print(f"[my_macro] Groups: {match.groups()}")
    else:
        print("[my_macro] No match found")

    return ProcMacroResult(modified_latex=modified_latex)
```

### Common Issues

1. **Pattern doesn't match:**
   - Print the input LaTeX
   - Print the pattern
   - Test pattern on regex testing websites
   - Check for escaped characters

2. **Macro doesn't run:**
   - Check meta function returns `use_result=True`
   - Verify pattern in meta function matches
   - Check index priority

3. **Infinite loop:**
   - Add iteration limit
   - Ensure pattern changes after replacement
   - Break if no match found

4. **LaTeX parsing fails:**
   - Wrap in try-except
   - Use fallback for failed parsing
   - Check if LaTeX is valid

## See Also

- [Cell Functions](cell-functions.md) - Process transformed LaTeX
- [Meta Functions](meta-functions.md) - Control when functions run
- [Plugin Development Guide](plugin-development.md) - Main documentation

