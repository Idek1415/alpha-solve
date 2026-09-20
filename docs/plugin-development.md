# Alpha Solve Plugin Development Guide

This guide explains how to write plugins for Alpha Solve, a mathematical computation system that processes LaTeX expressions and maintains a context of variables.

## Table of Contents

1. [Overview](#overview)
2. [Plugin Structure](#plugin-structure)
3. [The Manifest File](#the-manifest-file)
4. [Function Types](#function-types)
   - [Cell Functions](cell-functions.md) - Process input and return results
   - [Meta Functions](meta-functions.md) - Control when functions are available
   - [Proc Macros](proc-macros.md) - Transform LaTeX before processing
5. [Alpha Solve Library](#alpha-solve-library)
6. [SymPy Tools Library](#sympy-tools-library)
7. [Quick Start Example](#quick-start-example)
8. [Best Practices](#best-practices)
9. [Next Steps](#next-steps)

## Overview

Alpha Solve plugins extend the system's capabilities by providing:
- **Cell Functions**: Process mathematical expressions and update the context
- **Meta Functions**: Determine when a cell function should be available
- **Proc Macros**: Transform LaTeX before it reaches cell functions

Plugins are written in Python and use SymPy for symbolic mathematics. They have access to:
- The current cell's LaTeX content
- The global context (variables and their values)
- User selections from dropdown menus

## Plugin Structure

A basic plugin consists of:

```
plugins/
  my_plugin/
    manifest.toml          # Plugin metadata and function declarations
    my_function.py         # Implementation files
    another_function.py
```

Each Python file typically contains:
- A **meta function** (optional but recommended) - determines when the function is available
- A **cell function** - performs the actual computation

## The Manifest File

The `manifest.toml` file declares your plugin and its functions.

### Basic Structure

```toml
[plugin]
id = "author.plugin_name"               # Unique identifier (reverse domain notation)
name = "Human Readable Plugin Name"     # Display name
version = "1.0.0"                        # Semantic version
python_libraries = ["sympy", "numpy"]   # Python libraries your plugin needs

# Cell functions with meta functions
[[functions]]
functionName = "my_function"            # Must match Python function name

[[functions]]
functionName = "another_function"

# Proc macros (LaTeX transformers)
[[proc_macros]]
functionName = "my_macro"               # The macro function
metaFunctionName = "meta_my_macro"      # Determines when macro runs
```

### Python Libraries

Common libraries available:
- `sympy` - Symbolic mathematics (automatically includes `sympy_tools`)
- `numpy` - Numerical arrays and operations
- `scipy` - Scientific computing
- `matplotlib` - Plotting (if needed)

## Function Types

Alpha Solve plugins use three types of functions that work together:

### 1. Cell Functions

**Cell functions** process user input and return results.

- Receive the cell's LaTeX content and current context
- Perform computations (solve equations, simplify expressions, etc.)
- Return visible solutions and an updated context

**📖 [Complete Cell Functions Guide](cell-functions.md)**

Quick example:
```python
from alpha_solve import CellFunctionInput, CellFunctionResult
from sympy_tools import from_latex, to_latex
from sympy import simplify

def simple_simplify(input_data: CellFunctionInput) -> CellFunctionResult:
    """Simplify a mathematical expression."""
    latex = input_data.cell.get('latex', '').strip()
    expr = from_latex(latex)
    simplified = simplify(expr)

    return CellFunctionResult(
        visible_solutions=[to_latex(simplified)],
        new_context=input_data.context
    )
```

### 2. Meta Functions

**Meta functions** determine when a cell function should be available.

- Check if the input is appropriate for a specific function
- Return `True` to make the function available, `False` to hide it
- Can provide dropdown menus for user choices

**📖 [Complete Meta Functions Guide](meta-functions.md)**

Quick example:
```python
from alpha_solve import MetaFunctionResult
from sympy.core.relational import Equality
from sympy_tools import from_latex

def meta_solve_simple(input_data: CellFunctionInput) -> MetaFunctionResult:
    """Only show solver for equations with variables."""
    try:
        latex = input_data.cell.get('latex', '').strip()
        if not latex:
            return MetaFunctionResult(index=100, name='Solver', use_result=False)

        expr = from_latex(latex)
        if isinstance(expr, Equality) and expr.free_symbols:
            return MetaFunctionResult(index=100, name='Solver', use_result=True)

        return MetaFunctionResult(index=100, name='Solver', use_result=False)
    except:
        return MetaFunctionResult(index=100, name='Solver', use_result=False)
```

### 3. Proc Macros

**Proc macros** transform LaTeX before cell functions process it.

- Receive LaTeX string and context
- Transform the LaTeX (evaluate integrals, expand notation, etc.)
- Return modified LaTeX

**📖 [Complete Proc Macros Guide](proc-macros.md)**

Quick example:
```python
from alpha_solve import ProcMacroInput, ProcMacroResult
from sympy_tools import from_latex, to_latex
from sympy import integrate, symbols
import re

def evaluate_integrals(input_data: ProcMacroInput) -> ProcMacroResult:
    """Evaluate definite integrals in LaTeX."""
    pattern = r'\\int_\{([^}]+)\}\^\{([^}]+)\}\\left\((.*?)\\right\)d([a-zA-Z])'
    match = re.search(pattern, input_data.latex)

    if match:
        # Parse and evaluate integral
        integrand = from_latex(match.group(3))
        var = symbols(match.group(4))
        result = integrate(integrand, (var, ...))
        # Replace integral with result
        ...

    return ProcMacroResult(modified_latex=input_data.latex)
```

## Alpha Solve Library

The `alpha_solve` module provides data structures for plugin communication.

### Core Classes

#### `Variable`
Represents a named variable with values.

```python
from alpha_solve import Variable

# Create variables
var1 = Variable(name='x', type='analytical', values=['2', '3', '4'])
var2 = Variable(name='y', type='numerical', values=['1.5'])

# Convenience constructors
var3 = Variable.create_analytical('a', ['sqrt(2)', 'pi'])
var4 = Variable.create_numerical('b', ['3.14159'])

# Access properties
print(var1.name)      # 'x'
print(var1.type)      # 'analytical'
print(var1.values)    # ['2', '3', '4']
```

**Types:**
- `analytical`: Symbolic expressions (e.g., "sqrt(2)", "pi", "x + 1")
- `numerical`: Numeric values (e.g., "1.414", "3.14159")

#### `Context`
Manages the collection of variables.

```python
from alpha_solve import Context, Variable

# Access from input
context = input_data.context

# Get a variable
x_var = context.get_variable('x')
if x_var:
    print(x_var.values)

# Create new context with updated variables
new_vars = list(context.variables)
new_vars.append(Variable.create_analytical('z', ['solution']))
new_context = Context(variables=new_vars)
```

#### `CellFunctionInput`
Input to cell functions.

```python
def my_function(input_data: CellFunctionInput) -> CellFunctionResult:
    # Access cell content
    latex = input_data.cell.get('latex', '')
    cell_id = input_data.cell.get('id', '')

    # Access context
    for var in input_data.context.variables:
        print(f"{var.name} = {var.values}")

    # Get dropdown selection (if provided)
    selected = input_data.get_dropdown_selection("Solve for")
    if selected:
        print(f"User selected: {selected}")
```

#### `CellFunctionResult`
Output from cell functions.

```python
from alpha_solve import CellFunctionResult, Context, Variable

return CellFunctionResult(
    visible_solutions=[
        'x = 2',           # Displayed to user as LaTeX
        'x = 3'
    ],
    new_context=Context(variables=[
        Variable.create_analytical('x', ['2', '3'])
    ])
)
```

#### `MetaFunctionResult`
Output from meta functions.

```python
from alpha_solve import MetaFunctionResult, Dropdown

# Don't use this function
return MetaFunctionResult(
    index=100,
    name='My Function',
    use_result=False
)

# Use this function with a dropdown
return MetaFunctionResult(
    index=100,
    name='My Function',
    use_result=True,
    dropdowns=[
        Dropdown(title="Choose variable", items=['x', 'y', 'z'])
    ]
)
```

#### `Dropdown`
Provides user choices.

```python
from alpha_solve import Dropdown

dropdown = Dropdown(
    title="Integration method",
    items=["Analytical", "Numerical", "Monte Carlo"]
)
```

#### `DropdownSelection`
User's choice (automatically provided in `CellFunctionInput`).

```python
# In cell function
selected_method = input_data.get_dropdown_selection("Integration method")
if selected_method == "Analytical":
    # Use analytical method
    pass
```

### Working with Context Variables

Common pattern: substitute context variables into expressions.

```python
from sympy import symbols, sympify
from itertools import product

# Get expression free symbols
expr_vars = expr.free_symbols

# Find context variables that appear in expression
context_vars_with_values = []
for context_var in input_data.context.variables:
    var_symbol = symbols(context_var.name)
    if var_symbol in expr_vars:
        context_vars_with_values.append((var_symbol, context_var.values))

# Generate all combinations of values
if context_vars_with_values:
    var_symbols = [v[0] for v in context_vars_with_values]
    value_lists = [v[1] for v in context_vars_with_values]

    for value_combo in product(*value_lists):
        # Create substitution dictionary
        subs_dict = dict(zip(var_symbols, [sympify(v) for v in value_combo]))

        # Substitute into expression
        result = expr.subs(subs_dict)
        print(f"Result: {result}")
```

## SymPy Tools Library

The `sympy_tools` module provides LaTeX ↔ SymPy conversion.

### `from_latex(latex_str)`
Converts LaTeX to SymPy expressions.

```python
from sympy_tools import from_latex

# Expressions
expr = from_latex(r"x^2 + 2x + 1")
# Returns: x**2 + 2*x + 1

# Equations
eq = from_latex(r"x^2 = 4")
# Returns: Eq(x**2, 4)

# Fractions
expr = from_latex(r"\frac{a}{b}")
# Returns: a/b

# Greek letters
expr = from_latex(r"\alpha + \beta")
# Returns: alpha + beta

# Functions
expr = from_latex(r"\sin(x) + \cos(x)")
# Returns: sin(x) + cos(x)

# Square roots
expr = from_latex(r"\sqrt{2}")
# Returns: sqrt(2)

# Derivatives (prime notation)
expr = from_latex(r"x' + x = 0")
# Returns: Derivative(x, t) + x = 0

# Integrals
expr = from_latex(r"\int_0^1 x^2 dx")
# Returns: Integral(x**2, (x, 0, 1))
```

**Supported LaTeX:**
- Exponents: `^` or `^{}`
- Fractions: `\frac{num}{den}`
- Square roots: `\sqrt{expr}`
- Greek letters: `\alpha`, `\beta`, etc.
- Functions: `\sin`, `\cos`, `\tan`, `\ln`, `\log`, `\exp`
- Derivatives: prime notation (`x'`, `x''`)
- Integrals: `\int_{a}^{b} f(x) dx` or `\int f(x) dx`
- Multiplication: `\cdot`, `\times`
- Constants: `\pi`, `\e`

### `to_latex(expr)`
Converts SymPy expressions to LaTeX.

```python
from sympy_tools import to_latex
from sympy import symbols, sqrt, Eq

x = symbols('x')
expr = x**2 + 2*x + 1

latex = to_latex(expr)
# Returns: "x^{2} + 2 x + 1"

eq = Eq(x, sqrt(2))
latex = to_latex(eq)
# Returns: "x = \sqrt{2}"
```

## Quick Start Example

Here's a complete minimal plugin that simplifies mathematical expressions:

**File: `plugins/my_simplifier/manifest.toml`**
```toml
[plugin]
id = "myname.my_simplifier"
name = "My Simplifier"
version = "1.0.0"
python_libraries = ["sympy"]

[[functions]]
functionName = "simple_simplify"
```

**File: `plugins/my_simplifier/simplify.py`**
```python
from sympy import simplify
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, CellFunctionResult, MetaFunctionResult
from sympy_tools import from_latex, to_latex

def meta_simple_simplify(input_data: CellFunctionInput) -> MetaFunctionResult:
    """Only simplify expressions (not equations)."""
    try:
        latex = input_data.cell.get('latex', '').strip()
        if not latex or '=' in latex:
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        expr = from_latex(latex)
        if isinstance(expr, Equality):
            return MetaFunctionResult(index=50, name='Simplify', use_result=False)

        return MetaFunctionResult(index=50, name='Simplify', use_result=True)
    except:
        return MetaFunctionResult(index=50, name='Simplify', use_result=False)

def simple_simplify(input_data: CellFunctionInput) -> CellFunctionResult:
    """Simplify a mathematical expression."""
    latex = input_data.cell.get('latex', '').strip()

    try:
        expr = from_latex(latex)
        simplified = simplify(expr)
        result_latex = to_latex(simplified)

        return CellFunctionResult(
            visible_solutions=[result_latex],
            new_context=input_data.context
        )
    except Exception as e:
        return CellFunctionResult(
            visible_solutions=[f"Error: {str(e)}"],
            new_context=input_data.context
        )
```

That's it! Your plugin will now appear as "Simplify" when users enter expressions (but not equations).

For more complex examples, see:
- **[Cell Functions Guide](cell-functions.md)** - Equation solvers, ODE solvers, evaluators
- **[Meta Functions Guide](meta-functions.md)** - Advanced filtering and dropdown examples
- **[Proc Macros Guide](proc-macros.md)** - Integral evaluation, notation expansion

## Best Practices

### General Guidelines

1. **Error Handling**
   - Meta functions should never throw exceptions - always return `use_result=False` on error
   - Cell functions should catch exceptions and return meaningful error messages
   - Proc macros should return original LaTeX if transformation fails

2. **Performance**
   - Keep meta functions fast (they run on every cell change)
   - Avoid expensive computations in meta functions
   - Save complex work for cell functions

3. **User Experience**
   - Use clear, descriptive names for functions
   - Provide dropdowns when multiple options exist
   - Return helpful error messages
   - Use appropriate index/priority values

4. **Context Management**
   - Always create new `Context` objects, never modify existing ones
   - Remove old variables before adding updated versions
   - Use `Variable.create_analytical()` or `Variable.create_numerical()` helpers

5. **Testing**
   - Test with simple cases first
   - Test with and without context variables
   - Test edge cases (empty input, invalid LaTeX)
   - Test with multiple variable values

### Detailed Best Practices

For detailed best practices specific to each function type, see:
- **[Cell Functions Best Practices](cell-functions.md#best-practices)**
- **[Meta Functions Best Practices](meta-functions.md#best-practices)**
- **[Proc Macros Best Practices](proc-macros.md#best-practices)**

## Next Steps

### Learning Path

1. **Start Simple**: Create a basic simplifier or evaluator
   - Focus on cell functions and meta functions
   - Skip proc macros initially

2. **Study Examples**: Examine the `alpha_solve_analytical` plugin
   - `solve_simple.py` - Equation solver with dropdown
   - `simplify.py` - Expression simplifier
   - `solve_ode.py` - ODE solver
   - `check_equal.py` - Equality checker
   - `evaluate_integrals_macro.py` - Proc macro example

3. **Add Complexity**: Gradually add features
   - Handle context variables
   - Add dropdown menus
   - Create proc macros
   - Handle multiple variable values

4. **Test Thoroughly**: Verify your plugin works correctly
   - Test with various inputs
   - Check edge cases
   - Verify context updates

### Common Plugin Ideas

- **Numerical solvers** - Use NumPy/SciPy for numerical solutions
- **Matrix operations** - Linear algebra operations
- **Calculus** - Derivatives, integrals, limits
- **Statistics** - Mean, variance, distributions
- **Unit conversion** - Convert between units
- **Custom notation** - Expand domain-specific notation

### Reference Guides

- **[Cell Functions](cell-functions.md)** - Complete guide with examples
- **[Meta Functions](meta-functions.md)** - Control when functions are available
- **[Proc Macros](proc-macros.md)** - Transform LaTeX before processing

### Getting Help

- Check the `alpha_solve_analytical` and `alpha_solve_numerical` plugin source code
- Use print statements to debug (output appears in browser console)
- Test incrementally - start simple and add complexity gradually

