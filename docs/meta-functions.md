# Meta Functions

Meta functions determine **when** a [cell function](cell-functions.md) should be available to the user. They act as filters and validators.

## Overview

Meta functions:
- Check if the cell content is appropriate for a specific function
- Run before the cell function is offered to the user
- Return a `MetaFunctionResult` indicating whether to use the function
- Can provide dropdown menus for user choices
- Should be fast and never throw exceptions

## Why Meta Functions?

Without meta functions, every function would appear for every cell. Meta functions ensure that:
- Solvers only appear for equations they can solve
- Simplifiers only appear for expressions (not equations)
- Functions only appear when all required variables are defined
- Users get relevant options, not every possible function

## Function Signature

```python
from alpha_solve import CellFunctionInput, MetaFunctionResult

def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    """
    Check if my_function should be available for this cell.

    Args:
        input_data: Contains cell content and context

    Returns:
        Result indicating whether to use the function
    """
    pass
```

## Naming Convention

Meta functions must be named `meta_` + the cell function name:

```python
# Cell function
def solve_simple(input_data: CellFunctionInput) -> CellFunctionResult:
    pass

# Its meta function
def meta_solve_simple(input_data: CellFunctionInput) -> MetaFunctionResult:
    pass
```

## Return Structure

### Don't Use This Function

```python
from alpha_solve import MetaFunctionResult

return MetaFunctionResult(
    index=100,              # Priority (lower runs first)
    name='My Function',     # Display name
    use_result=False        # Don't use this function
)
```

### Use This Function

```python
return MetaFunctionResult(
    index=100,
    name='My Function',
    use_result=True         # Use this function!
)
```

### Use This Function with Dropdown

```python
from alpha_solve import MetaFunctionResult, Dropdown

return MetaFunctionResult(
    index=100,
    name='My Function',
    use_result=True,
    dropdowns=[
        Dropdown(
            title="Choose variable",
            items=['x', 'y', 'z']
        )
    ]
)
```

### Multiple Dropdowns

```python
return MetaFunctionResult(
    index=100,
    name='My Function',
    use_result=True,
    dropdowns=[
        Dropdown(title="Solve for", items=['x', 'y']),
        Dropdown(title="Method", items=['Analytical', 'Numerical'])
    ]
)
```

## Index Priority

The `index` parameter determines execution order. Lower numbers run first.

### Recommended Ranges

- **0-25**: High priority checkers (need all variables defined)
  - Example: Equality checker that validates solutions
- **25-50**: Medium-high priority
  - Example: Partial checkers
- **50-75**: Simplifiers and formatters
  - Example: Expression simplifier
- **75-100**: Equation solvers
  - Example: ODE solver, algebraic solver
- **100+**: General purpose functions
  - Example: Generic evaluator

### Why Priority Matters

If multiple functions can handle the same cell, the one with the lowest index is preferred. This ensures more specific functions are chosen over generic ones.

```python
# Specific ODE solver - higher priority (lower index)
def meta_solve_ode(input_data: CellFunctionInput) -> MetaFunctionResult:
    # ... check for derivatives ...
    return MetaFunctionResult(index=90, name='ODE Solver', use_result=True)

# Generic solver - lower priority (higher index)
def meta_solve_generic(input_data: CellFunctionInput) -> MetaFunctionResult:
    # ... check for any equation ...
    return MetaFunctionResult(index=100, name='Generic Solver', use_result=True)
```

## Common Checks

### Check for Content

```python
def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    latex = input_data.cell.get('latex', '').strip()

    if not latex:
        return MetaFunctionResult(index=100, name='My Function', use_result=False)

    # Continue with other checks...
```

### Check if LaTeX Parses

```python
from sympy_tools import from_latex

def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        latex = input_data.cell.get('latex', '').strip()
        expr = from_latex(latex)
        # Continue with checks...
    except Exception:
        # Can't parse - don't use this function
        return MetaFunctionResult(index=100, name='My Function', use_result=False)
```

### Check if Expression is an Equation

```python
from sympy.core.relational import Equality
from sympy_tools import from_latex

def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        expr = from_latex(latex)

        # Must be an equation
        if not isinstance(expr, Equality):
            return MetaFunctionResult(index=100, name='My Function', use_result=False)

        return MetaFunctionResult(index=100, name='My Function', use_result=True)
    except Exception:
        return MetaFunctionResult(index=100, name='My Function', use_result=False)
```

### Check if Expression is NOT an Equation

```python
def meta_simplify(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        expr = from_latex(latex)

        # Must NOT be an equation
        if isinstance(expr, Equality):
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        # Also check raw LaTeX for equals sign
        if '=' in latex:
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        return MetaFunctionResult(index=50, name='Simplify', use_result=True)
    except Exception:
        return MetaFunctionResult(index=50, name='Simplify', use_result=False)
```

### Check for Variables

```python
def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        expr = from_latex(latex)

        # Must have variables
        if not expr.free_symbols:
            return MetaFunctionResult(index=100, name='My Function', use_result=False)

        return MetaFunctionResult(index=100, name='My Function', use_result=True)
    except Exception:
        return MetaFunctionResult(index=100, name='My Function', use_result=False)
```

### Check for Specific Expression Type

```python
from sympy import Derivative

def meta_solve_ode(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        expr = from_latex(latex)

        # Must contain derivatives
        has_derivative = any(isinstance(arg, Derivative) for arg in expr.atoms(Derivative))

        if not has_derivative:
            return MetaFunctionResult(index=90, name='ODE Solver', use_result=False)

        return MetaFunctionResult(index=90, name='ODE Solver', use_result=True)
    except Exception:
        return MetaFunctionResult(index=90, name='ODE Solver', use_result=False)
```

### Check Context Variables

```python
def meta_check_equal(input_data: CellFunctionInput) -> MetaFunctionResult:
    """Only use if ALL variables are defined in context."""
    try:
        expr = from_latex(latex)

        # Get all context variable names
        context_var_names = {v.name for v in input_data.context.variables}

        # Check if ALL variables are defined
        all_defined = all(
            str(symbol) in context_var_names
            for symbol in expr.free_symbols
        )

        if not all_defined:
            return MetaFunctionResult(index=25, name='Check Equality', use_result=False)

        return MetaFunctionResult(index=25, name='Check Equality', use_result=True)
    except Exception:
        return MetaFunctionResult(index=25, name='Check Equality', use_result=False)
```

### Check for Unsolved Variables

```python
def meta_solve_simple(input_data: CellFunctionInput) -> MetaFunctionResult:
    """Only use if there are unsolved variables."""
    try:
        expr = from_latex(latex)

        context_var_names = {v.name for v in input_data.context.variables}

        # Find variables NOT in context
        unsolved_vars = [
            str(symbol) for symbol in sorted(expr.free_symbols, key=str)
            if str(symbol) not in context_var_names
        ]

        if not unsolved_vars:
            # All variables already solved
            return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)

        return MetaFunctionResult(index=100, name='Simple Solver', use_result=True)
    except Exception:
        return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)
```

## Complete Examples

### Example 1: Simple Equation Solver Meta Function

```python
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, MetaFunctionResult, Dropdown
from sympy_tools import from_latex

def meta_solve_simple(input_data: CellFunctionInput) -> MetaFunctionResult:
    """
    Check if we can solve this equation.
    Use only if:
    - Content exists
    - Parses successfully
    - Is an equation
    - Has variables
    - Has at least one unsolved variable
    """
    try:
        latex = input_data.cell.get('latex', '').strip()

        # Must have content
        if not latex:
            return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)

        # Must parse
        expr = from_latex(latex)

        # Must be an equation
        if not isinstance(expr, Equality):
            return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)

        # Must have variables
        if not expr.free_symbols:
            return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)

        # Must have unsolved variables
        context_var_names = {v.name for v in input_data.context.variables}
        unsolved_vars = [
            str(symbol) for symbol in sorted(expr.free_symbols, key=str)
            if str(symbol) not in context_var_names
        ]

        if not unsolved_vars:
            return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)

        # Provide dropdown if multiple variables
        dropdowns = None
        if len(unsolved_vars) > 1:
            dropdowns = [Dropdown(title="Solve for", items=unsolved_vars)]

        return MetaFunctionResult(
            index=100,
            name='Simple Solver',
            use_result=True,
            dropdowns=dropdowns
        )

    except Exception:
        return MetaFunctionResult(index=100, name='Simple Solver', use_result=False)
```

### Example 2: Simplifier Meta Function

```python
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, MetaFunctionResult
from sympy_tools import from_latex

def meta_simple_simplify(input_data: CellFunctionInput) -> MetaFunctionResult:
    """
    Check if expression can be simplified.
    Use only if:
    - Content exists
    - Parses successfully
    - Is NOT an equation
    """
    try:
        latex = input_data.cell.get('latex', '').strip()

        if not latex:
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        expr = from_latex(latex)

        # Must NOT be an equation
        if isinstance(expr, Equality):
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        # Double-check for equals sign in raw LaTeX
        if '=' in latex:
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        return MetaFunctionResult(index=50, name='Simplify', use_result=True)

    except Exception:
        return MetaFunctionResult(index=50, name='Simplify', use_result=False)
```

### Example 3: ODE Solver Meta Function

```python
from sympy import Derivative
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, MetaFunctionResult
from sympy_tools import from_latex

def meta_solve_ode(input_data: CellFunctionInput) -> MetaFunctionResult:
    """
    Check if this is a differential equation.
    Use only if:
    - Content exists
    - Parses successfully
    - Is an equation
    - Contains derivatives
    """
    try:
        latex = input_data.cell.get('latex', '').strip()

        if not latex:
            return MetaFunctionResult(index=90, name='ODE Solver', use_result=False)

        expr = from_latex(latex)

        # Must be an equation
        if not isinstance(expr, Equality):
            return MetaFunctionResult(index=90, name='ODE Solver', use_result=False)

        # Must contain derivatives
        has_derivative = any(isinstance(arg, Derivative) for arg in expr.atoms(Derivative))

        if not has_derivative:
            return MetaFunctionResult(index=90, name='ODE Solver', use_result=False)

        return MetaFunctionResult(index=90, name='ODE Solver', use_result=True)

    except Exception:
        return MetaFunctionResult(index=90, name='ODE Solver', use_result=False)
```

### Example 4: Equality Checker Meta Function

```python
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, MetaFunctionResult
from sympy_tools import from_latex

def meta_check_equal(input_data: CellFunctionInput) -> MetaFunctionResult:
    """
    Check if we can verify this equation.
    Use only if:
    - Content exists
    - Parses successfully
    - Is an equation
    - ALL variables are defined in context
    """
    try:
        latex = input_data.cell.get('latex', '').strip()

        if not latex:
            return MetaFunctionResult(index=25, name='Check Equality', use_result=False)

        expr = from_latex(latex)

        # Must be an equation
        if not isinstance(expr, Equality):
            return MetaFunctionResult(index=25, name='Check Equality', use_result=False)

        # ALL variables must be defined
        context_var_names = {v.name for v in input_data.context.variables}
        all_defined = all(
            str(symbol) in context_var_names
            for symbol in expr.free_symbols
        )

        if not all_defined:
            return MetaFunctionResult(index=25, name='Check Equality', use_result=False)

        return MetaFunctionResult(index=25, name='Check Equality', use_result=True)

    except Exception:
        return MetaFunctionResult(index=25, name='Check Equality', use_result=False)
```

## Working with Dropdowns

### When to Provide Dropdowns

Provide dropdowns when:
- Multiple variables could be solved for
- Multiple methods are available
- User needs to make a choice

### Single Dropdown

```python
from alpha_solve import Dropdown

# Get available variables
unsolved_vars = ['x', 'y', 'z']

if len(unsolved_vars) > 1:
    dropdown = Dropdown(title="Solve for", items=unsolved_vars)
    return MetaFunctionResult(
        index=100,
        name='Solver',
        use_result=True,
        dropdowns=[dropdown]
    )
```

### Multiple Dropdowns

```python
dropdown1 = Dropdown(title="Variable", items=['x', 'y'])
dropdown2 = Dropdown(title="Method", items=['Analytical', 'Numerical'])

return MetaFunctionResult(
    index=100,
    name='Solver',
    use_result=True,
    dropdowns=[dropdown1, dropdown2]
)
```

### Conditional Dropdowns

```python
dropdowns = []

# Only add dropdown if needed
if len(variables) > 1:
    dropdowns.append(Dropdown(title="Solve for", items=variables))

if has_multiple_methods:
    dropdowns.append(Dropdown(title="Method", items=['Fast', 'Accurate']))

return MetaFunctionResult(
    index=100,
    name='Solver',
    use_result=True,
    dropdowns=dropdowns if dropdowns else None
)
```

## Best Practices

### 1. Always Use Try-Except

Meta functions should **never** throw exceptions:

```python
def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        # All checks here
        pass
    except Exception:
        # ANY error means don't use this function
        return MetaFunctionResult(index=100, name='My Function', use_result=False)
```

### 2. Fail Fast

Return `False` as soon as any condition fails:

```python
# ✓ Good: Early returns
if not latex:
    return MetaFunctionResult(..., use_result=False)

if not isinstance(expr, Equality):
    return MetaFunctionResult(..., use_result=False)

return MetaFunctionResult(..., use_result=True)

# ✗ Bad: Nested conditions
if latex:
    if isinstance(expr, Equality):
        return MetaFunctionResult(..., use_result=True)
return MetaFunctionResult(..., use_result=False)
```

### 3. Keep Meta Functions Fast

Meta functions run on every cell evaluation, so they should be quick:

```python
# ✓ Good: Simple checks
if not latex:
    return False
if '=' not in latex:
    return False

# ✗ Bad: Expensive operations
result = complex_solver(expr)  # Don't solve in meta function!
if result:
    return True
```

### 4. Be Specific in Checks

The more specific your checks, the better the user experience:

```python
# ✓ Good: Specific checks
def meta_solve_ode(input_data: CellFunctionInput) -> MetaFunctionResult:
    # Check for derivatives specifically
    has_derivative = any(isinstance(arg, Derivative) for arg in expr.atoms(Derivative))
    if not has_derivative:
        return MetaFunctionResult(..., use_result=False)

# ✗ Bad: Too generic
def meta_solve_anything(input_data: CellFunctionInput) -> MetaFunctionResult:
    # Just check if it parses
    if latex:
        return MetaFunctionResult(..., use_result=True)
```

### 5. Use Appropriate Index Values

Choose index values that reflect priority:

```python
# High priority: specific, well-defined checks
meta_solve_ode -> index=90

# Medium priority: general solvers
meta_solve_simple -> index=100

# Low priority: catch-all functions
meta_evaluate_generic -> index=200
```

### 6. Provide Dropdowns for Choices

If there are multiple valid options, let the user choose:

```python
# ✓ Good: Dropdown for multiple variables
if len(unsolved_vars) > 1:
    dropdowns = [Dropdown(title="Solve for", items=unsolved_vars)]

# ✗ Bad: Arbitrary choice
var = unsolved_vars[0]  # User can't control which variable
```

### 7. Document Your Logic

Explain what conditions must be met:

```python
def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    """
    Check if my_function should be available.

    Use only if:
    - Cell has LaTeX content
    - LaTeX parses to a SymPy expression
    - Expression is an equation
    - At least one variable is unsolved
    """
```

## Common Patterns

### Pattern: Check Expression Type

```python
from sympy.core.relational import Equality
from sympy import Derivative, Integral

# Is it an equation?
if isinstance(expr, Equality):
    # It's an equation

# Contains derivatives?
if expr.atoms(Derivative):
    # Has derivatives

# Contains integrals?
if expr.atoms(Integral):
    # Has integrals
```

### Pattern: Variable Status

```python
# All variables defined?
context_var_names = {v.name for v in input_data.context.variables}
all_defined = all(str(sym) in context_var_names for sym in expr.free_symbols)

# Any variables undefined?
any_undefined = any(str(sym) not in context_var_names for sym in expr.free_symbols)

# Get undefined variables
undefined_vars = [str(sym) for sym in expr.free_symbols if str(sym) not in context_var_names]
```

### Pattern: Quick LaTeX Checks

```python
latex = input_data.cell.get('latex', '').strip()

# Has equals sign?
if '=' in latex:
    # Likely an equation

# Has integral?
if '\\int' in latex:
    # Has integral notation

# Has derivative (prime)?
if "'" in latex:
    # Has prime notation
```

## Debugging

Use print statements to debug meta functions:

```python
def meta_my_function(input_data: CellFunctionInput) -> MetaFunctionResult:
    try:
        latex = input_data.cell.get('latex', '').strip()
        print(f"[meta_my_function] LaTeX: {latex}")

        expr = from_latex(latex)
        print(f"[meta_my_function] Parsed: {expr}")
        print(f"[meta_my_function] Type: {type(expr)}")

        if isinstance(expr, Equality):
            print("[meta_my_function] Is equation: True")
            return MetaFunctionResult(..., use_result=True)
        else:
            print("[meta_my_function] Is equation: False")
            return MetaFunctionResult(..., use_result=False)

    except Exception as e:
        print(f"[meta_my_function] Error: {e}")
        return MetaFunctionResult(..., use_result=False)
```

## See Also

- [Cell Functions](cell-functions.md) - The functions that meta functions enable
- [Proc Macros](proc-macros.md) - Transform LaTeX before processing
- [Plugin Development Guide](plugin-development.md) - Main documentation

