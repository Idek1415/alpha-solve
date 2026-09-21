"""Solve connected engineering equations as systems inside Alpha Solve's Pyodide runtime."""

import math
import re
from collections import defaultdict

from sympy import Eq, Symbol, latex, linear_eq_to_matrix, linsolve, solve, sympify
from sympy.core.sympify import SympifyError

from sympy_tools import from_latex


MAX_SYMBOLIC_UNKNOWNS = 6


def _numeric(value):
    try:
        result = complex(value.evalf())
    except (AttributeError, TypeError, ValueError):
        try:
            result = complex(value)
        except (TypeError, ValueError):
            return None
    if not all(math.isfinite(part) for part in (result.real, result.imag)):
        return None
    return result.real if abs(result.imag) <= 1e-9 * max(1.0, abs(result.real)) else None


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
    if config.get("min") not in (None, "") and value < float(config["min"]) - 1e-8:
        return False
    if config.get("max") not in (None, "") and value > float(config["max"]) + 1e-8:
        return False
    return True


def _symbolic_candidates(expressions, symbols):
    if len(symbols) > MAX_SYMBOLIC_UNKNOWNS:
        return []
    try:
        matrix, vector = linear_eq_to_matrix(expressions, symbols)
        solutions = linsolve((matrix, vector), symbols)
        return [dict(zip(symbols, values)) for values in solutions]
    except (ValueError, TypeError):
        pass
    try:
        return solve(expressions, symbols, dict=True, simplify=False, check=True)
    except (ValueError, TypeError, NotImplementedError, SympifyError):
        return []


def _choose_candidate(candidates, symbols, settings):
    usable = []
    for candidate in candidates:
        if any(symbol not in candidate for symbol in symbols):
            continue
        values = {str(symbol): _numeric(candidate[symbol]) for symbol in symbols}
        if any(value is None for value in values.values()):
            continue
        if all(_within_bounds(name, value, settings) for name, value in values.items()):
            if not any(all(abs(value - other[name]) < 1e-8 for name, value in values.items()) for other in usable):
                usable.append(values)
    if len(usable) == 1:
        return usable[0], "symbolic"
    if len(usable) > 1 and all(settings.get(str(symbol), {}).get("guess") not in (None, "") for symbol in symbols):
        def distance(values):
            return sum((values[str(symbol)] - float(settings[str(symbol)]["guess"])) ** 2 for symbol in symbols)
        usable.sort(key=distance)
        if len(usable) == 1 or distance(usable[0]) + 1e-10 < distance(usable[1]):
            return usable[0], "symbolic"
    return None, "multiple" if len(usable) > 1 else "none"


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

    def residual(values):
        try:
            errors = [float(function(*values)) for function in functions]
            scales = [max(abs(float(left(*values))), abs(float(right(*values))), 1e-12)
                      for left, right in sides_functions]
            if not all(math.isfinite(value) for value in errors + scales):
                raise ValueError("non-finite residual")
            return [error / scale for error, scale in zip(errors, scales)]
        except (ValueError, TypeError, OverflowError, ZeroDivisionError):
            return [1e30] * len(functions)

    result = least_squares(residual, guesses, bounds=(lower, upper), max_nfev=500)
    errors = residual(result.x)
    if not result.success or any(abs(error) > 1e-7 for error in errors):
        return None, "Numerical solving did not satisfy every equation; check the guesses, bounds, and model."
    return dict(zip(names, map(float, result.x))), "numerical"


def solve_system(payload):
    """Return values, per-cell results, and diagnostics without changing user inputs."""
    known = {}
    diagnostics = []
    settings = {}
    for item in payload.get("targets", []):
        name = item.get("name", "")
        if not name and all(item.get(field) in (None, "") for field in ("guess", "min", "max")):
            continue
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
            diagnostics.append("Solver target names must match an equation variable (letters, digits, underscores).")
            continue
        try:
            for field in ("guess", "min", "max"):
                if item.get(field) not in (None, "") and not math.isfinite(float(item[field])):
                    raise ValueError("non-finite value")
            if item.get("min") not in (None, "") and item.get("max") not in (None, "") and float(item["min"]) >= float(item["max"]):
                raise ValueError("minimum must be less than maximum")
        except (TypeError, ValueError) as error:
            diagnostics.append("Solver target %s has an invalid guess or bound (%s)." % (name, error))
            continue
        settings[name] = item
    for item in payload.get("known", []):
        try:
            value = sympify(item["value"])
            if not value.free_symbols:
                known[Symbol(item["name"])] = value
        except (ValueError, TypeError, SympifyError):
            diagnostics.append("Input %s could not be interpreted as a number." % item["name"])

    records = []
    for item in payload.get("equations", []):
        if not item.get("latex", "").strip():
            continue
        try:
            equation = from_latex(item["latex"])
            if not isinstance(equation, Eq):
                raise ValueError("not an equation")
            left, right = equation.lhs.subs(known), equation.rhs.subs(known)
            expression = left - right
            records.append({"id": item["id"], "title": item.get("title") or "Equation",
                            "expression": expression, "sides": (left, right),
                            "symbols": expression.free_symbols})
        except (ValueError, TypeError, SyntaxError, SympifyError) as error:
            diagnostics.append("%s: unsupported equation (%s)." % (item.get("title") or "Equation", error))

    results = {}
    by_cell = defaultdict(list)
    blocked_variables = set()
    blocked_cells = set()
    for group, symbols in _connected_components(records):
        expressions = [item["expression"] for item in group]
        sides = [item["sides"] for item in group]
        label = ", ".join(item["title"] for item in group[:3])
        if not symbols:
            if any(_numeric(expression) is not None and abs(_numeric(expression)) > 1e-8 for expression in expressions):
                diagnostics.append("%s: equation conflicts with known inputs." % label)
            continue
        if len(expressions) < len(symbols):
            diagnostics.append("%s: %d equations for %d unknowns; add a constraint or input." %
                               (label, len(expressions), len(symbols)))
            continue
        candidate, reason = _choose_candidate(_symbolic_candidates(expressions, symbols), symbols, settings)
        if candidate is None:
            if reason == "multiple":
                blocked_variables.update(map(str, symbols))
                blocked_cells.update(item["id"] for item in group)
                diagnostics.append("%s: multiple solutions; add bounds or initial guesses to select one." % label)
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
        results.update({name: {"value": str(value), "method": reason} for name, value in candidate.items()})
        for item in group:
            for symbol in symbols:
                name = str(symbol)
                by_cell[item["id"]].append(latex(symbol) + "=" + latex(sympify(candidate[name])))

    return {"variables": results, "solutionsByCell": dict(by_cell),
            "blockedVariables": sorted(blocked_variables), "blockedCells": sorted(blocked_cells),
            "diagnostics": diagnostics}
