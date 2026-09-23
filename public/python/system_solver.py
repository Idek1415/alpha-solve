"""Solve connected engineering equations as systems inside Alpha Solve's Pyodide runtime."""

import math
import re
from collections import defaultdict
from functools import lru_cache

from sympy import Eq, Symbol, latex, linear_eq_to_matrix, linsolve, solve, sympify, simplify, Derivative, Pow, factor_terms
from sympy.core.function import AppliedUndef
from sympy.core.sympify import SympifyError

from sympy_tools import from_latex


MAX_SYMBOLIC_UNKNOWNS = 6


@lru_cache(maxsize=512)
def _parse_equation(source):
    """LaTeX parsing dominates repeat dependency passes; SymPy trees are immutable."""
    return from_latex(source, evaluate=False)


def _stable_value(value):
    """Keep useful precision while suppressing binary floating-point tails."""
    expression = sympify(value)
    if expression.is_Float:
        numeric = float(expression)
        if abs(numeric) < 1e-14:
            numeric = 0.0
        return format(numeric, ".14g")
    if expression.is_Integer:
        return str(expression)
    return str(expression.evalf(15))


def _expand_user_functions(expression, definitions):
    """Inline project equations such as f(x)=x^3 at every later call site."""
    expanded = expression
    for _ in range(max(1, len(definitions) + 1)):
        changed = False

        def replace_call(call):
            nonlocal changed
            definition = definitions.get(call.func.__name__)
            if definition is None:
                return call
            arguments, body = definition
            if len(arguments) != len(call.args):
                raise ValueError("function %s expects %d argument(s), received %d" %
                                 (call.func.__name__, len(arguments), len(call.args)))
            changed = True
            return body.subs(dict(zip(arguments, call.args)), simultaneous=True)

        expanded = expanded.replace(lambda node: isinstance(node, AppliedUndef), replace_call)
        if not changed:
            return expanded
    if expanded.has(AppliedUndef):
        raise ValueError("recursive or circular function definition")
    return expanded


def _numeric(value):
    if getattr(value, 'is_real', None) is False:
        return None
    try:
        result = complex(value.evalf())
    except (AttributeError, TypeError, ValueError):
        try:
            result = complex(value)
        except (TypeError, ValueError):
            return None
    if not all(math.isfinite(part) for part in (result.real, result.imag)):
        return None
    # A small imaginary root is still imaginary, not an approximate real zero.
    return result.real if result.imag == 0 else None


def resolve_computed_values(payload):
    """Substitute unambiguous scalar values into dependent variables and card results."""
    variables = payload.get("variables", [])
    local_symbols = {variable["name"]: Symbol(variable["name"]) for variable in variables}
    expressions = {}
    for variable in variables:
        parsed = []
        for value in variable.get("values", []):
            try:
                expression = sympify(value, locals=local_symbols)
                parsed.append(expression if hasattr(expression, "subs") and hasattr(expression, "free_symbols") else None)
            except (ValueError, TypeError, SyntaxError, SympifyError):
                parsed.append(None)
        expressions[variable["name"]] = parsed

    known = {}
    for _ in range(len(variables)):
        changed = False
        for variable in variables:
            name = variable["name"]
            values = expressions[name]
            if Symbol(name) in known or len(values) != 1 or values[0] is None:
                continue
            candidate = values[0].subs(known)
            if not candidate.free_symbols and _numeric(candidate) is not None:
                known[Symbol(name)] = candidate
                changed = True
        if not changed:
            break

    resolved_variables = []
    for variable in variables:
        resolved = dict(variable)
        values = []
        numeric = True
        for original, parsed in zip(variable.get("values", []), expressions[variable["name"]]):
            if parsed is None:
                values.append(original)
                numeric = False
                continue
            result = parsed.subs(known)
            values.append(_stable_value(result) if not result.free_symbols and _numeric(result) is not None
                          else (str(result) if result != parsed else original))
            numeric = numeric and not result.free_symbols and _numeric(result) is not None
        resolved["values"] = values
        if values and numeric:
            resolved["type"] = "numerical"
        resolved_variables.append(resolved)

    resolved_cells = {}
    for cell_id, solutions in payload.get("solutionsByCell", {}).items():
        resolved_cells[cell_id] = []
        for solution in solutions:
            wrapped = solution.startswith("$$") and solution.endswith("$$")
            source = solution[2:-2] if wrapped else solution
            try:
                equation = from_latex(source)
                if not isinstance(equation, Eq):
                    raise ValueError("not an equation")
                right = equation.rhs.subs(known)
                if right == equation.rhs:
                    resolved_cells[cell_id].append(solution)
                    continue
                rendered = latex(equation.lhs) + "=" + latex(right)
                resolved_cells[cell_id].append("$$" + rendered + "$$" if wrapped else rendered)
            except Exception:
                resolved_cells[cell_id].append(solution)

    return {"variables": resolved_variables, "solutionsByCell": resolved_cells}


def _connected_components(records):
    remaining = list(records)
    groups = []
    while remaining:
        group = [remaining.pop(0)]
        symbols = set(group[0]["symbols"])
        changed = True
        while changed:
            changed = False
            for record in remaining[:]:
                if symbols.intersection(record["symbols"]):
                    remaining.remove(record)
                    group.append(record)
                    symbols.update(record["symbols"])
                    changed = True
        groups.append((group, sorted(symbols, key=str)))
    return groups


def _within_bounds(name, value, settings):
    config = settings.get(name, {})
    if config.get("min") not in (None, "") and value < sympify(config["min"]):
        return False
    if config.get("max") not in (None, "") and value > sympify(config["max"]):
        return False
    return True


def _symbolic_candidates(expressions, symbols):
    try:
        matrix, vector = linear_eq_to_matrix(expressions, symbols)
        solutions = linsolve((matrix, vector), symbols)
        return [dict(zip(symbols, values)) for values in solutions]
    except (ValueError, TypeError):
        pass
    if len(symbols) > MAX_SYMBOLIC_UNKNOWNS:
        return None
    try:
        return solve(expressions, symbols, dict=True, simplify=False, check=True)
    except (ValueError, TypeError, NotImplementedError, SympifyError):
        return None


def _satisfies(sides, substitutions):
    """Check the original sides and denominators, including domains lost by simplification."""
    for left, right in sides:
        for expression in (left, right):
            for power in expression.atoms(Pow):
                if power.exp.is_negative and power.base.subs(substitutions) == 0:
                    return False
        left = left.subs(substitutions, simultaneous=True).doit()
        right = right.subs(substitutions, simultaneous=True).doit()
        a, b = _numeric(left), _numeric(right)
        if a is None or b is None:
            return False
        if simplify(left - right) == 0:
            continue
        error = abs((left - right).evalf(50))
        scale = max(abs(left.evalf(50)), abs(right.evalf(50)))
        if error > sympify('1e-10') * scale:
            return False
    return True


def _choose_candidate(candidates, symbols, settings, sides=None):
    if candidates is None:
        return None, "unknown"
    usable = []
    exact = []
    parametric = False
    for candidate in candidates:
        if any(symbol not in candidate for symbol in symbols):
            parametric = True
            continue
        if any(candidate[symbol].free_symbols for symbol in symbols):
            parametric = True
            continue
        values = {str(symbol): _numeric(candidate[symbol]) for symbol in symbols}
        if any(value is None for value in values.values()):
            continue
        if sides is not None and not _satisfies(sides, candidate):
            continue
        if all(_within_bounds(str(symbol), candidate[symbol], settings) for symbol in symbols):
            if not any(all(simplify(candidate[symbol] - other[symbol]) == 0 for symbol in symbols) for other in exact):
                exact.append(candidate)
                usable.append({str(symbol): candidate[symbol] for symbol in symbols})
    if len(usable) == 1:
        return usable[0], "symbolic"
    if len(usable) > 1 and all(settings.get(str(symbol), {}).get("guess") not in (None, "") for symbol in symbols):
        def distance(values):
            return sum((values[str(symbol)] - sympify(settings[str(symbol)]["guess"])) ** 2 for symbol in symbols)
        usable.sort(key=distance)
        if distance(usable[0]) < distance(usable[1]):
            return usable[0], "symbolic"
    return None, "multiple" if len(usable) > 1 else ("underdetermined" if parametric else "no_solution")


def _numerical_solution(expressions, sides, symbols, settings):
    names = [str(symbol) for symbol in symbols]
    if any(settings.get(name, {}).get("guess") in (None, "") for name in names):
        return None, "Set an initial guess for every unknown in this group to enable numerical solving."
    guesses = [float(settings[name]["guess"]) for name in names]
    lower = [float(settings[name]["min"]) if settings[name].get("min") not in (None, "") else -math.inf for name in names]
    upper = [float(settings[name]["max"]) if settings[name].get("max") not in (None, "") else math.inf for name in names]
    if any(not low < guess < high for low, guess, high in zip(lower, guesses, upper)):
        return None, "Each initial guess must lie strictly between its bounds."
    from scipy.optimize import least_squares
    from sympy import lambdify

    functions = [lambdify(symbols, expression, modules="numpy") for expression in expressions]
    sides_functions = [(lambdify(symbols, left, modules="numpy"),
                        lambdify(symbols, right, modules="numpy")) for left, right in sides]

    # Fixed scales preserve the root-finding objective. Dividing by x**2 at
    # every iterate, for example, turns the residual of x**2=0 into a constant.
    scales = []
    for left, right in sides_functions:
        try:
            scale = max(abs(float(left(*guesses))), abs(float(right(*guesses))))
            scales.append(scale if math.isfinite(scale) and scale > 0 else 1.0)
        except (ValueError, TypeError, OverflowError, ZeroDivisionError):
            scales.append(1.0)

    def residual(values):
        try:
            errors = [float(function(*values)) for function in functions]
            if not all(math.isfinite(value) for value in errors + scales):
                raise ValueError("non-finite residual")
            return [error / scale for error, scale in zip(errors, scales)]
        except (ValueError, TypeError, OverflowError, ZeroDivisionError):
            return [1e30] * len(functions)

    result = least_squares(residual, guesses, bounds=(lower, upper), max_nfev=1000,
                           ftol=1e-12, xtol=1e-12, gtol=None)
    errors = residual(result.x)
    if not result.success or any(abs(error) > 1e-9 for error in errors):
        return None, "Numerical solving did not satisfy every equation; check the guesses, bounds, and model."
    substitutions = dict(zip(symbols, map(float, result.x)))
    for expression, (left, right) in zip(expressions, sides):
        for side in (left, right):
            if _numeric(sympify(side).subs(substitutions).doit()) is None:
                return None, 'The numerical candidate is outside the real domain of an original equation.'
            if any(power.exp.is_negative and power.base.subs(substitutions) == 0 for power in sympify(side).atoms(Pow)):
                return None, 'The numerical candidate lies at a pole of an original equation.'
        a = _numeric(sympify(left).subs(substitutions).doit())
        b = _numeric(sympify(right).subs(substitutions).doit())
        coefficient = _numeric(factor_terms(expression).as_coeff_Mul()[0])
        final_scale = max(abs(a), abs(b), abs(coefficient or 1.0))
        if abs(a - b) > 1e-9 * final_scale:
            return None, 'The numerical candidate fails the original equation residual check.'
    from numpy.linalg import matrix_rank
    if matrix_rank(result.jac) < len(symbols):
        return None, 'The numerical constraints are dependent; no unique solution was established.'
    return dict(zip(names, map(float, result.x))), "numerical"


def solve_system(payload):
    """Return values, per-cell results, and diagnostics without changing user inputs."""
    known = {}
    diagnostics = []
    settings = {}
    invalid_input = False
    for item in payload.get("targets", []):
        name = item.get("name", "")
        if not name and all(item.get(field) in (None, "") for field in ("guess", "min", "max")):
            continue
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
            invalid_input = True
            diagnostics.append("Solver target names must match an equation variable (letters, digits, underscores).")
            continue
        try:
            for field in ("guess", "min", "max"):
                if item.get(field) not in (None, "") and not math.isfinite(float(item[field])):
                    raise ValueError("non-finite value")
            if item.get("min") not in (None, "") and item.get("max") not in (None, "") and float(item["min"]) >= float(item["max"]):
                raise ValueError("minimum must be less than maximum")
        except (TypeError, ValueError) as error:
            invalid_input = True
            diagnostics.append("Solver target %s has an invalid guess or bound (%s)." % (name, error))
            continue
        settings[name] = item
    for item in payload.get("known", []):
        try:
            value = sympify(item["value"])
            if not value.free_symbols and _numeric(value) is not None:
                known[Symbol(item["name"])] = value
            else:
                raise ValueError('not a finite real scalar')
        except (ValueError, TypeError, AttributeError, SympifyError):
            invalid_input = True
            diagnostics.append("Input %s could not be interpreted as a number." % item["name"])

    parsed_items = []
    definitions = {}
    for item in payload.get("equations", []):
        if not item.get("latex", "").strip():
            continue
        try:
            equation = _parse_equation(item["latex"])
            if not isinstance(equation, Eq):
                raise ValueError("not an equation")
            if isinstance(equation.lhs, AppliedUndef):
                arguments = tuple(equation.lhs.args)
                if not arguments or any(not isinstance(argument, Symbol) for argument in arguments):
                    raise ValueError("function definitions require symbolic arguments")
                definitions[equation.lhs.func.__name__] = (arguments, equation.rhs)
                continue
            parsed_items.append((item, equation))
        except (ValueError, TypeError, SyntaxError, SympifyError) as error:
            diagnostics.append("%s: unsupported equation (%s)." % (item.get("title") or "Equation", error))

    records = []
    for item, equation in parsed_items:
        try:
            equation = Eq(_expand_user_functions(equation.lhs, definitions),
                          _expand_user_functions(equation.rhs, definitions), evaluate=False)
            if equation.has(Derivative, AppliedUndef):
                # Differential equations belong to the analytical ODE solver.
                continue
            left, right = equation.lhs.subs(known, simultaneous=True), equation.rhs.subs(known, simultaneous=True)
            expression = left - right
            records.append({"id": item["id"], "title": item.get("title") or "Equation",
                            "expression": expression, "sides": (left, right),
                            "symbols": left.free_symbols | right.free_symbols})
        except (ValueError, TypeError, SyntaxError, SympifyError) as error:
            diagnostics.append("%s: unsupported equation (%s)." % (item.get("title") or "Equation", error))

    results = {}
    by_cell = defaultdict(list)
    blocked_variables = set()
    blocked_cells = set()
    if invalid_input:
        return {"variables": {}, "solutionsByCell": {},
                "blockedVariables": sorted({str(symbol) for item in records for symbol in item['symbols']}),
                "blockedCells": [item['id'] for item in records], "diagnostics": diagnostics}
    for group, symbols in _connected_components(records):
        expressions = [item["expression"] for item in group]
        sides = [item["sides"] for item in group]
        label = ", ".join(item["title"] for item in group[:3])
        if not symbols:
            if not _satisfies(sides, {}):
                blocked_cells.update(item['id'] for item in group)
                diagnostics.append("%s: equation conflicts with known inputs or is undefined/non-real." % label)
            continue
        if len(expressions) < len(symbols):
            diagnostics.append("%s: %d equations for %d unknowns; add a constraint or input." %
                               (label, len(expressions), len(symbols)))
            continue
        candidate, reason = _choose_candidate(_symbolic_candidates(expressions, symbols), symbols, settings, sides)
        if candidate is None:
            if reason == "multiple":
                blocked_variables.update(map(str, symbols))
                blocked_cells.update(item["id"] for item in group)
                diagnostics.append("%s: multiple solutions; add bounds or initial guesses to select one." % label)
                continue
            if reason in ("no_solution", "underdetermined"):
                if reason == "no_solution":
                    blocked_variables.update(map(str, symbols))
                    blocked_cells.update(item["id"] for item in group)
                    diagnostics.append("%s: no solution satisfies the real-valued equations and bounds." % label)
                else:
                    diagnostics.append("%s: dependent constraints leave free unknowns; no unique solution." % label)
                continue
            try:
                candidate, reason = _numerical_solution(expressions, sides, symbols, settings)
            except ImportError:
                return {"needsScipy": True}
            except (ValueError, TypeError, OverflowError) as error:
                diagnostics.append("%s: numerical solving failed (%s)." % (label, error))
                continue
            if candidate is None:
                diagnostics.append("%s: %s" % (label, reason))
                continue
        results.update({name: {"value": _stable_value(value), "method": reason} for name, value in candidate.items()})
        for item in group:
            for symbol in symbols:
                name = str(symbol)
                by_cell[item["id"]].append(latex(symbol) + "=" + latex(sympify(_stable_value(candidate[name]))))

    return {"variables": results, "solutionsByCell": dict(by_cell),
            "blockedVariables": sorted(blocked_variables), "blockedCells": sorted(blocked_cells),
            "diagnostics": diagnostics}
