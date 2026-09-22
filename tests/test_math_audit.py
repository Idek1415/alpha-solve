"""Mathematical regressions: parsing, branch selection, domains, and residuals."""
import sys
import unittest
from pathlib import Path

from sympy import Symbol, sqrt, simplify, Rational, Derivative, Function, Eq, dsolve
import importlib.util

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'public' / 'python'))
from sympy_tools import from_latex
from system_solver import solve_system, _numerical_solution


def system(*equations, targets=None, known=None):
    return solve_system({
        'equations': [{'id': str(i), 'latex': eq, 'title': eq} for i, eq in enumerate(equations)],
        'known': known or [], 'targets': targets or []
    })


class ParserAudit(unittest.TestCase):
    def test_roots_and_fractions_preserve_grouping(self):
        for text, expected in [
            (r'\sqrt{\sqrt{81}}', 3),
            (r'\sqrt{x^{2}+9}', sqrt(Symbol('x')**2 + 9)),
            (r'\frac{1}{\sqrt{4}}', 1 / 2),
            (r'\sqrt[3]{27}', 3),
            (r'\sqrt[3]{-8}', -2),
            (r'\frac{\sqrt{16}}{\sqrt[3]{8}}', 2),
            (r'\sin^{2}(x)+\cos^{2}(x)', 1),
            (r'c\cdot\sqrt{x}', Symbol('c') * sqrt(Symbol('x'))),
            (r'c\times\sqrt{x}', Symbol('c') * sqrt(Symbol('x'))),
            (r'c\sqrt{x}', Symbol('c') * sqrt(Symbol('x'))),
            (r'c\frac{1}{\sqrt{x}}', Symbol('c') / sqrt(Symbol('x'))),
        ]:
            with self.subTest(text=text):
                self.assertEqual(simplify(from_latex(text) - expected), 0)

    def test_unknown_commands_are_not_silently_variables(self):
        with self.assertRaises(ValueError):
            from_latex(r'\unknown{x}')

    def test_prime_derivative_retains_function_dependence(self):
        self.assertNotEqual(from_latex("y'").doit(), 0)

    def test_calculus_and_transcendental_identities(self):
        for text, expected in [
            (r'\int_0^1 x^2 dx', Rational(1, 3)),
            (r'\int_{0}^{\frac{1}{2}} x dx', Rational(1, 8)),
            (r'\ln(\e)', 1),
            (r'\frac{dx}{dx}', 1),
            (r'\sin(\pi/2)', 1),
            (r'|-3|', 3),
            (r'\sqrt{(-3)^2}', 3),
        ]:
            with self.subTest(text=text):
                self.assertEqual(simplify(from_latex(text).doit() - expected), 0)
        x = Symbol('x')
        y = Function('y')(x)
        self.assertEqual(from_latex(r'\frac{d^2y}{dx^2}+y=0'), Eq(Derivative(y, x, 2) + y, 0))
        self.assertTrue(dsolve(from_latex("y'+y=0")).rhs.has(Symbol('t')))


class SolverAudit(unittest.TestCase):
    def test_small_distinct_roots_stay_ambiguous(self):
        result = system('x^2=10^{-20}')
        self.assertEqual(result['variables'], {})
        self.assertIn('x', result['blockedVariables'])

    def test_small_imaginary_roots_are_not_real_zero(self):
        result = system('x^2=-10^{-20}')
        self.assertEqual(result['variables'], {})

    def test_positive_bound_excludes_small_negative_root(self):
        result = system('x^2=10^{-20}', targets=[{'name': 'x', 'min': '0'}])
        self.assertGreater(float(result['variables']['x']['value']), 0)

    def test_principal_square_root_does_not_add_negative_branch(self):
        result = system(r'x=\sqrt{4}')
        self.assertEqual(float(result['variables']['x']['value']), 2)

    def test_extraneous_root_is_rejected(self):
        result = system(r'\sqrt{x}=-2')
        self.assertEqual(result['variables'], {})

    def test_inconsistent_linear_system_reports_inconsistency(self):
        result = system('x=1', 'x=2')
        self.assertEqual(result['variables'], {})
        self.assertTrue(any('no solution' in d.lower() or 'inconsistent' in d.lower() for d in result['diagnostics']))

    def test_linear_system_is_not_limited_to_six_unknowns(self):
        result = system(*[f'x_{i}=x_{i+1}+1' for i in range(7)], 'x_7=1')
        self.assertEqual(float(result['variables']['x_0']['value']), 8)

    def test_undefined_known_equation_is_reported(self):
        result = system('y=1/x', known=[{'name': 'y', 'value': '1'}, {'name': 'x', 'value': '0'}])
        self.assertTrue(result['diagnostics'])

    def test_cancelled_denominator_does_not_admit_its_pole(self):
        result = system(r'\frac{x^2-1}{x-1}=2')
        self.assertEqual(result['variables'], {})

    def test_root_selection_across_scales(self):
        for exponent in [-30, -10, 0, 10, 30]:
            with self.subTest(exponent=exponent):
                result = system(f'x^2=10^{{{exponent * 2}}}', targets=[{'name': 'x', 'min': '0'}])
                self.assertAlmostEqual(float(result['variables']['x']['value']) / 10**exponent, 1)

    def test_discharge_coefficient_multiplies_the_root(self):
        result = system(r'U=Cd\cdot\sqrt{\frac{2\cdot dP}{rho}}', known=[
            {'name': 'Cd', 'value': '0.8'}, {'name': 'dP', 'value': '46843.495935424'},
            {'name': 'rho', 'value': '750'}])
        expected = 0.8 * (2 * 46843.495935424 / 750)**0.5
        self.assertAlmostEqual(float(result['variables']['U']['value']), expected, places=10)

    def test_dependent_linear_constraints_do_not_invent_values(self):
        result = system('x+y=2', '2*x+2*y=4')
        self.assertEqual(result['variables'], {})
        self.assertTrue(result['diagnostics'])

    def test_invalid_input_does_not_become_an_unknown(self):
        result = system('x=2', known=[{'name': 'x', 'value': 'nan'}])
        self.assertEqual(result['variables'], {})
        self.assertTrue(result['diagnostics'])


@unittest.skipIf(importlib.util.find_spec('scipy') is None, 'SciPy is not installed')
class NumericalAudit(unittest.TestCase):
    def test_nonlinear_root_zero_has_a_nonconstant_residual(self):
        x = Symbol('x')
        result, _ = _numerical_solution([x*x], [(x*x, 0*x)], [x], {'x': {'guess': '1'}})
        self.assertIsNotNone(result)
        self.assertLess(abs(result['x']), 1e-5)

    def test_no_real_root_is_not_returned_as_least_squares_minimum(self):
        x = Symbol('x')
        for guess in ['0.5', '1e12']:
            result, _ = _numerical_solution([x*x+1], [(x*x, -1+0*x)], [x], {'x': {'guess': guess}})
            self.assertIsNone(result)

    def test_numerical_scaled_equations_satisfy_original_equations(self):
        x = Symbol('x')
        for scale in [1e-15, 1, 1e15]:
            result, _ = _numerical_solution([scale*(x*x-2)], [(scale*x*x, scale+scale+0*x)], [x], {'x': {'guess': '1'}})
            self.assertIsNotNone(result)
            self.assertAlmostEqual(result['x']**2, 2, places=9)


if __name__ == '__main__':
    unittest.main()
