"""Regression cases for coupled engineering equations."""

import sys
import importlib.util
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "public" / "python"))

from system_solver import solve_system


def equation(cell_id, latex):
    return {"id": cell_id, "title": cell_id, "latex": latex}


class SystemSolverTests(unittest.TestCase):
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
