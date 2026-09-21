"""Regression cases for coupled engineering equations."""

import sys
import importlib.util
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "public" / "python"))

from system_solver import resolve_computed_values, solve_system


def equation(cell_id, latex):
    return {"id": cell_id, "title": cell_id, "latex": latex}


class SystemSolverTests(unittest.TestCase):
    def test_carries_later_numeric_values_into_earlier_expressions(self):
        result = resolve_computed_values({
            "variables": [
                {"name": "BF", "type": "analytical", "values": ["0.381/LMR"], "unit": ""},
                {"name": "pitch_f", "type": "analytical", "values": ["LMR", "0.993*LMR"], "unit": "m"},
                {"name": "LMR", "type": "numerical", "values": ["1.0"], "unit": ""},
            ],
            "solutionsByCell": {"ratio": [r"BF=\frac{0.381}{LMR}"]}
        })
        variables = {variable["name"]: variable for variable in result["variables"]}
        self.assertAlmostEqual(float(variables["BF"]["values"][0]), 0.381)
        self.assertEqual(variables["pitch_f"]["values"], ["1.00000000000000", "0.993000000000000"])
        self.assertEqual(variables["pitch_f"]["unit"], "m")
        self.assertNotIn("LMR", result["solutionsByCell"]["ratio"][0])

    def test_does_not_choose_a_value_from_multiple_branches(self):
        result = resolve_computed_values({
            "variables": [
                {"name": "x", "type": "numerical", "values": ["-2", "2"], "unit": ""},
                {"name": "y", "type": "analytical", "values": ["x + 1"], "unit": ""},
            ],
            "solutionsByCell": {}
        })
        self.assertEqual(result["variables"][1]["values"], ["x + 1"])

    def test_engineering_names_override_sympy_constants(self):
        result = resolve_computed_values({
            "variables": [
                {"name": "stress", "type": "analytical", "values": ["E*I"], "unit": "Pa"},
                {"name": "E", "type": "numerical", "values": ["2"], "unit": "Pa"},
                {"name": "I", "type": "numerical", "values": ["3"], "unit": ""},
            ],
            "solutionsByCell": {}
        })
        self.assertEqual(result["variables"][0]["values"], ["6"])

    def test_solves_connected_equations_together(self):
        result = solve_system({
            "equations": [equation("sum", "x+y=3"), equation("difference", "x-y=1")],
            "known": [], "targets": []
        })
        self.assertEqual(float(result["variables"]["x"]["value"]), 2)
        self.assertEqual(float(result["variables"]["y"]["value"]), 1)
        self.assertIn("sum", result["solutionsByCell"])
        self.assertFalse(result["diagnostics"])

    def test_uses_bounds_to_select_physical_branch(self):
        result = solve_system({
            "equations": [equation("area", "d^2=4")], "known": [],
            "targets": [{"name": "d", "guess": "", "min": "0", "max": ""}]
        })
        self.assertEqual(float(result["variables"]["d"]["value"]), 2)

    def test_does_not_guess_when_branches_are_ambiguous(self):
        result = solve_system({
            "equations": [equation("area", "d^2=4")], "known": [], "targets": []
        })
        self.assertEqual(result["variables"], {})
        self.assertIn("multiple solutions", result["diagnostics"][0])
        self.assertEqual(result["blockedVariables"], ["d"])

    def test_reports_insufficient_equations(self):
        result = solve_system({
            "equations": [equation("flow", "x+y=3")], "known": [], "targets": []
        })
        self.assertEqual(result["variables"], {})
        self.assertIn("2 unknowns", result["diagnostics"][0])
        self.assertEqual(result["blockedVariables"], [])
        self.assertEqual(result["blockedCells"], [])

    def test_missing_numerical_guesses_do_not_invalidate_other_solutions(self):
        result = solve_system({
            "equations": [equation("nonlinear", r"x+\sin(x)=2")],
            "known": [], "targets": []
        })
        self.assertNotIn("needsScipy", result)
        self.assertEqual(result["blockedVariables"], [])
        self.assertEqual(result["blockedCells"], [])
        self.assertIn("initial guess", result["diagnostics"][0])

    def test_reports_conflicting_known_inputs(self):
        result = solve_system({
            "equations": [equation("check", "x=2")],
            "known": [{"name": "x", "value": "3"}], "targets": []
        })
        self.assertEqual(result["variables"], {})
        self.assertIn("conflicts", result["diagnostics"][0])

    @unittest.skipIf(importlib.util.find_spec("scipy") is None, "SciPy is not installed")
    def test_numerical_fallback_uses_guess_and_bounds(self):
        result = solve_system({
            "equations": [equation("nonlinear", r"x+\sin(x)=2")], "known": [],
            "targets": [{"name": "x", "guess": "1", "min": "0", "max": "2"}]
        })
        self.assertEqual(result["variables"]["x"]["method"], "numerical")
        self.assertAlmostEqual(float(result["variables"]["x"]["value"]), 1.1060601577, places=7)


if __name__ == "__main__":
    unittest.main()
