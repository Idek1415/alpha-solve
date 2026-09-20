# Cell Functions

Cell functions are the core of Alpha Solve plugins. They process user input and return results.

## Overview

Cell functions:
- Receive a `CellFunctionInput` with the cell content and context
- Process mathematical expressions (usually from LaTeX)
- Update the context with new variables or solutions
- Return a `CellFunctionResult` with solutions and updated context

## Function Signature

```python
from alpha_solve import CellFunctionInput, CellFunctionResult

def my_function(input_data: CellFunctionInput) -> CellFunctionResult:
    """
    Description of what this function does.

    Args:
        input_data: Contains cell content, context, and dropdown selections

    Returns:
        Result with visible solutions and updated context
    """
    pass
```

## Input Structure

### Accessing Cell Content

```python
def my_function(input_data: CellFunctionInput) -> CellFunctionResult:
    # Get the LaTeX content
    latex = input_data.cell.get('latex', '').strip()

    # Get cell ID (if needed)
    cell_id = input_data.cell.get('id', '')

    # Cell is a dictionary with various properties
    print(input_data.cell)
```

### Accessing Context

```python
def my_function(input_data: CellFunctionInput) -> CellFunctionResult:
    # Access all variables
    for var in input_data.context.variables:
        print(f"{var.name} = {var.values}")

    # Get specific variable
    x_var = input_data.context.get_variable('x')
    if x_var:
        print(f"x has values: {x_var.values}")
        print(f"x is {x_var.type}")  # 'analytical' or 'numerical'
```

### Accessing Dropdown Selections

If your [meta function](meta-functions.md) provides dropdowns, retrieve the user's selection:

```python
def my_function(input_data: CellFunctionInput) -> CellFunctionResult:
    # Get dropdown selection by title
    selected_var = input_data.get_dropdown_selection("Solve for")

    if selected_var:
        print(f"User selected: {selected_var}")
    else:
        # No selection (shouldn't happen if dropdown was required)
        print("No selection made")
```

## Return Structure

### Basic Return

```python
from alpha_solve import CellFunctionResult

return CellFunctionResult(
    visible_solutions=['x = 2', 'x = 3'],  # List of LaTeX strings to display
    new_context=input_data.context          # Updated context
)
```

### Updating Context

When your function solves for a variable or creates new values:

```python
from alpha_solve import CellFunctionResult, Variable, Context

# Get existing variables
new_variables = list(input_data.context.variables)

# Remove old variable with same name (if updating)
new_variables = [v for v in new_variables if v.name != 'x']

# Add new variable
new_var = Variable.create_analytical('x', ['2', '3', '4'])
new_variables.append(new_var)

# Create new context
new_context = Context(variables=new_variables)

return CellFunctionResult(
    visible_solutions=['x = 2', 'x = 3', 'x = 4'],
    new_context=new_context
)
```

### Keeping Context Unchanged

If your function only displays results without adding variables:

```python
return CellFunctionResult(
    visible_solutions=[result_latex],
    new_context=input_data.context  # Pass through unchanged
)
```

## Working with Context Variables

### Pattern: Substitute Context Variables

A common pattern is to substitute context variable values into an expression:

```python
from sympy import symbols, sympify
from itertools import product

def my_function(input_data: CellFunctionInput) -> CellFunctionResult:
    # Parse expression
    expr = from_latex(latex)

    # Find context variables that appear in the expression
    context_vars_with_values = []
    for context_var in input_data.context.variables:
        var_symbol = symbols(context_var.name)
        if var_symbol in expr.free_symbols:
            context_vars_with_values.append((var_symbol, context_var.values))

    visible_solutions = []

    if context_vars_with_values:
        # Get all variable symbols and their value lists
        var_symbols = [v[0] for v in context_vars_with_values]
        value_lists = [v[1] for v in context_vars_with_values]

        # Generate all combinations of values
        for value_combo in product(*value_lists):
            # Create substitution dictionary
            subs_dict = dict(zip(var_symbols, [sympify(v) for v in value_combo]))

            # Substitute and process
            result = expr.subs(subs_dict)
            visible_solutions.append(to_latex(result))
    else:
        # No substitutions needed
        result = expr
        visible_solutions.append(to_latex(result))

    return CellFunctionResult(
        visible_solutions=visible_solutions,
        new_context=input_data.context
    )
```

### Pattern: Handle Multiple Variable Values

Variables in context can have multiple values (e.g., `x = [2, 3, 4]`). Generate solutions for all combinations:

```python
from itertools import product
from sympy import sympify, symbols

# Example: x has values [2, 3] and y has values [1, 4]
# Generate solutions for: (2,1), (2,4), (3,1), (3,4)

var_symbols = [symbols('x'), symbols('y')]
value_lists = [['2', '3'], ['1', '4']]

for value_combo in product(*value_lists):
    # value_combo is ('2', '1'), then ('2', '4'), etc.
    subs_dict = dict(zip(var_symbols, [sympify(v) for v in value_combo]))
    # subs_dict is {x: 2, y: 1}, etc.

    result = expr.subs(subs_dict)
    # Process result
```

## Complete Examples

### Example 1: Simple Simplifier

```python
from alpha_solve import CellFunctionInput, CellFunctionResult
from sympy_tools import from_latex, to_latex
from sympy import simplify

def simple_simplify(input_data: CellFunctionInput) -> CellFunctionResult:
    """Simplify a mathematical expression."""
    latex = input_data.cell.get('latex', '').strip()

    # Validate input
    if not latex:
        return CellFunctionResult(
            visible_solutions=['No input provided'],
            new_context=input_data.context
        )

    try:
        # Parse LaTeX to SymPy expression
        expr = from_latex(latex)

        # Simplify it
        simplified = simplify(expr)

        # Convert back to LaTeX for display
        result_latex = to_latex(simplified)

        return CellFunctionResult(
            visible_solutions=[result_latex],
            new_context=input_data.context  # Context unchanged
        )
    except Exception as e:
        return CellFunctionResult(
            visible_solutions=[f"Error simplifying: {str(e)}"],
            new_context=input_data.context
        )
```

### Example 2: Equation Solver

```python
from sympy import solve, symbols, Eq
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, CellFunctionResult, Variable, Context
from sympy_tools import from_latex, to_latex

def solve_simple(input_data: CellFunctionInput) -> CellFunctionResult:
    """Solve a simple equation for one variable."""
    latex = input_data.cell.get('latex', '').strip()

    try:
        # Parse the equation
        equation = from_latex(latex)

        # Verify it's an equation
        if not isinstance(equation, Equality):
            return CellFunctionResult(
                visible_solutions=['Not an equation'],
                new_context=input_data.context
            )

        # Get the variable to solve for (from dropdown or first unsolved variable)
        selected_var_name = input_data.get_dropdown_selection("Solve for")

        if selected_var_name:
            var = symbols(selected_var_name)
        else:
            # Use first variable not in context
            context_var_names = {v.name for v in input_data.context.variables}
            unsolved_vars = [
                sym for sym in equation.free_symbols
                if str(sym) not in context_var_names
            ]
            if not unsolved_vars:
                return CellFunctionResult(
                    visible_solutions=['All variables already defined'],
                    new_context=input_data.context
                )
            var = unsolved_vars[0]

        # Solve the equation
        solutions = solve(equation, var)

        if not solutions:
            return CellFunctionResult(
                visible_solutions=[f"No solution found for {var}"],
                new_context=input_data.context
            )

        # Format solutions for display
        visible_solutions = []
        solution_strings = []

        for sol in solutions:
            # Display as "x = 2"
            visible_solutions.append(to_latex(Eq(var, sol)))
            # Store as string for context
            solution_strings.append(str(sol))

        # Update context with new variable
        new_variables = list(input_data.context.variables)
        new_variables = [v for v in new_variables if v.name != str(var)]
        new_variables.append(Variable.create_analytical(str(var), solution_strings))

        new_context = Context(variables=new_variables)

        return CellFunctionResult(
            visible_solutions=visible_solutions,
            new_context=new_context
        )

    except Exception as e:
        return CellFunctionResult(
            visible_solutions=[f"Error solving: {str(e)}"],
            new_context=input_data.context
        )
```

### Example 3: Expression Evaluator with Context

```python
from sympy import symbols, sympify, simplify
from itertools import product
from alpha_solve import CellFunctionInput, CellFunctionResult
from sympy_tools import from_latex, to_latex

def evaluate_expression(input_data: CellFunctionInput) -> CellFunctionResult:
    """
    Evaluate expression by substituting all context variable values.
    Generates one result for each combination of values.
    """
    latex = input_data.cell.get('latex', '').strip()

    try:
        expr = from_latex(latex)

        # Find context variables that appear in the expression
        context_vars_with_values = []
        for context_var in input_data.context.variables:
            var_symbol = symbols(context_var.name)
            if var_symbol in expr.free_symbols and context_var.values:
                context_vars_with_values.append((var_symbol, context_var.values))

        visible_solutions = []

        if context_vars_with_values:
            # Evaluate for all combinations of variable values
            var_symbols = [v[0] for v in context_vars_with_values]
            value_lists = [v[1] for v in context_vars_with_values]

            for value_combo in product(*value_lists):
                # Create substitution dictionary
                subs_dict = dict(zip(var_symbols, [sympify(v) for v in value_combo]))

                # Substitute and simplify
                result = simplify(expr.subs(subs_dict))
                visible_solutions.append(to_latex(result))
        else:
            # No context variables to substitute, just simplify
            result = simplify(expr)
            visible_solutions.append(to_latex(result))

        # Remove duplicates while preserving order
        visible_solutions = list(dict.fromkeys(visible_solutions))

        return CellFunctionResult(
            visible_solutions=visible_solutions,
            new_context=input_data.context  # Context unchanged
        )

    except Exception as e:
        return CellFunctionResult(
            visible_solutions=[f"Error evaluating: {str(e)}"],
            new_context=input_data.context
        )
```

### Example 4: ODE Solver

```python
from sympy import dsolve, symbols, Function, Derivative
from sympy.core.relational import Equality
from alpha_solve import CellFunctionInput, CellFunctionResult, Variable, Context
from sympy_tools import from_latex, to_latex

def solve_ode(input_data: CellFunctionInput) -> CellFunctionResult:
    """Solve an ordinary differential equation."""
    latex = input_data.cell.get('latex', '').strip()

    try:
        equation = from_latex(latex)

        # Verify it's an equation
        if not isinstance(equation, Equality):
            return CellFunctionResult(
                visible_solutions=['Not an equation'],
                new_context=input_data.context
            )

        # Find derivatives in the equation
        derivatives = equation.atoms(Derivative)
        if not derivatives:
            return CellFunctionResult(
                visible_solutions=['No derivatives found'],
                new_context=input_data.context
            )

        # Get the function being differentiated
        first_deriv = list(derivatives)[0]
        func_expr = first_deriv.expr
        diff_var = first_deriv.variables[0] if first_deriv.variables else symbols('t')

        # Convert to function if needed
        if func_expr.is_Symbol:
            func_name = str(func_expr)
            func = Function(func_name)(diff_var)

            # Build replacement dictionary
            replacements = {func_expr: func}
            for deriv in derivatives:
                if deriv.expr == func_expr:
                    order = sum(1 for v in deriv.variables if v == diff_var)
                    new_deriv = Derivative(func, (diff_var, order))
                    replacements[deriv] = new_deriv

            equation = equation.subs(replacements)
        else:
            func = func_expr
            func_name = str(func.func)

        # Solve the ODE
        solutions = dsolve(equation, func)

        # Handle single solution or list
        if not isinstance(solutions, list):
            solutions = [solutions]

        # Format solutions
        visible_solutions = []
        solution_exprs = []

        for solution in solutions:
            visible_solutions.append(to_latex(solution))
            if hasattr(solution, 'rhs'):
                solution_exprs.append(solution.rhs)

        # Update context
        if solution_exprs:
            new_variables = list(input_data.context.variables)
            new_variables = [v for v in new_variables if v.name != func_name]
            new_var = Variable.create_analytical(
                func_name,
                [str(expr) for expr in solution_exprs]
            )
            new_variables.append(new_var)
            new_context = Context(variables=new_variables)
        else:
            new_context = input_data.context

        return CellFunctionResult(
            visible_solutions=visible_solutions,
            new_context=new_context
        )

    except Exception as e:
        return CellFunctionResult(
            visible_solutions=[f"Error solving ODE: {str(e)}"],
            new_context=input_data.context
        )
```

## Best Practices

### 1. Always Validate Input

Check for empty or invalid input before processing:

```python
latex = input_data.cell.get('latex', '').strip()

if not latex:
    return CellFunctionResult(
        visible_solutions=['No input provided'],
        new_context=input_data.context
    )
```

### 2. Use Try-Except Blocks

Always catch exceptions and return meaningful error messages:

```python
try:
    # Process input
    pass
except ValueError as e:
    return CellFunctionResult(
        visible_solutions=[f"Invalid input: {str(e)}"],
        new_context=input_data.context
    )
except Exception as e:
    return CellFunctionResult(
        visible_solutions=[f"Error: {str(e)}"],
        new_context=input_data.context
    )
```

### 3. Remove Duplicate Solutions

When generating multiple solutions, remove duplicates:

```python
# Remove duplicates while preserving order
visible_solutions = list(dict.fromkeys(visible_solutions))
```

### 4. Update Context Carefully

Always create a new context; don't modify the existing one:

```python
# ✓ Good: Create new list
new_variables = list(input_data.context.variables)
new_variables.append(new_var)
new_context = Context(variables=new_variables)

# ✗ Bad: Modifying existing context
input_data.context.variables.append(new_var)  # Don't do this!
```

### 5. Handle Empty Solutions

Provide feedback when no solutions are found:

```python
if not solutions:
    return CellFunctionResult(
        visible_solutions=[f"No solution found for {var}"],
        new_context=input_data.context
    )
```

### 6. Format Output as LaTeX

Always convert SymPy expressions back to LaTeX for display:

```python
from sympy_tools import to_latex

result = simplify(expr)
visible_solutions = [to_latex(result)]  # Convert to LaTeX
```

### 7. Return Updated Context

Even if context doesn't change, always return it:

```python
# If context unchanged
return CellFunctionResult(
    visible_solutions=results,
    new_context=input_data.context  # Pass through
)

# If context updated
return CellFunctionResult(
    visible_solutions=results,
    new_context=new_context  # New context object
)
```

## Common Patterns

### Pattern: Find Unsolved Variables

Get variables that aren't already defined in context:

```python
from sympy import symbols

context_var_names = {v.name for v in input_data.context.variables}
unsolved_vars = [
    sym for sym in expr.free_symbols
    if str(sym) not in context_var_names
]
```

### Pattern: Check if All Variables Are Defined

```python
context_var_names = {v.name for v in input_data.context.variables}
all_defined = all(
    str(sym) in context_var_names
    for sym in expr.free_symbols
)
```

### Pattern: Get Specific Context Variable

```python
x_var = input_data.context.get_variable('x')
if x_var:
    # Use x_var.values
    pass
```

### Pattern: Remove and Replace Variable

```python
# Remove old variable
new_variables = [v for v in input_data.context.variables if v.name != 'x']

# Add new variable
new_variables.append(Variable.create_analytical('x', ['new_value']))

new_context = Context(variables=new_variables)
```

## Debugging

Use print statements to debug (output appears in browser console):

```python
print(f"[my_function] Input LaTeX: {latex}")
print(f"[my_function] Parsed expression: {expr}")
print(f"[my_function] Context variables: {[v.name for v in input_data.context.variables]}")
print(f"[my_function] Result: {result}")
```

## See Also

- [Meta Functions](meta-functions.md) - Determine when cell functions are available
- [Proc Macros](proc-macros.md) - Transform LaTeX before cell functions
- [Plugin Development Guide](plugin-development.md) - Main documentation

