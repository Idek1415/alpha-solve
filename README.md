# Alpha Solve App

Alpha Solve is a local-first engineering workspace for equations, parameters, executable Python functions, and calculated results. The interface is Angular 20 and the desktop shell is Tauri 2.

built on alpha solve by Jack Neeleman (icanthink42)

## Solver update (0.4.0)

Connected algebraic equations are now solved together. The optional Solver targets panel lets you give an unknown an initial guess and lower or upper bounds, all in coherent SI units. If symbolic solving cannot finish, a numerical SciPy solver uses those guesses and checks the result against every equation. Ambiguous solutions, conflicting inputs, and systems with too few equations are reported above the calculation cards. These settings travel with exported system JSON.

The new solver runs within the existing Pyodide runtime. SciPy is downloaded when numerical solving is first needed, so the first numerical run requires network access. Unsupported equations still use the existing analytical plugin. Run `python -m unittest discover -s tests -v` for the solver regression cases.

Open projects remain in the explorer when creating or opening another project. Cards and projects have collapse controls, and calculation handles support drag reordering. Parameter names and equations use math-aware editors with subscript support. Help provides feature topics and keyboard navigation.

Native Open and Save dialogs start in `Documents/Alpha Solve App`. Export JSON uses the same Save dialog and displays the full saved path. Runtime status stays in the bottom bar. Long equation results scroll horizontally instead of being clipped. Recognized SI inputs are normalized, and compatible equation units are inferred and preserved through convergent solver passes. Light mode now uses light variable editors and scrollbars with a dark, visible typing cursor.

Validation: production and Windows installer builds; regression tests for retaining projects, reorder/undo, collapse state, multi-pass dependency convergence, unit inference, and unit preservation. Native window minimize/maximize and native file-dialog interactions still require Windows smoke testing.

## Current product slice

- Multiple engineering systems in one workspace
- Ordered equation, Python function, and engineering-note cards
- Input parameters with descriptions and units
- Computed-variable inspection and stale-result tracking
- Existing Python/SymPy plugin solver support
- Coupled symbolic equations and numerical fallback with guesses and bounds
- Fixed-point dependency passes so later outputs can feed earlier calculations
- Math-formatted input and computed variable names, including subscripts
- Coherent-SI input normalization and direct-equation unit inference
- Named equations and self-describing LLM analysis exports
- Direct re-import of both portable system JSON and self-describing LLM JSON
- Dark and light engineering-workspace themes
- Executable code cells containing one top-level Python function
- Autosave, recovery, undo, and redo
- Versioned workspace files and per-system JSON import/export
- JSON Schema for LLM-generated systems

Code-cell arguments are resolved by name from parameters and prior results. A function must return a dictionary whose keys become downstream variables:

```python
def calculate(m, k, c):
    omega_n = (k / m) ** 0.5
    zeta = c / (2 * (k * m) ** 0.5)
    return {"omega_n": omega_n, "zeta": zeta}
```

## Web development

```powershell
npm ci
npm start
```

Open `http://localhost:4200`.

## Desktop development

Install the Tauri Windows prerequisites, including Rust and Microsoft C++ Build Tools, then run:

```powershell
npm ci
npm run desktop
```

Create the Windows installer with:

```powershell
npm run desktop:build
```

## System JSON interchange

The system interchange contract is documented by [`docs/system.schema.json`](docs/system.schema.json). A complete importable example is available at [`docs/examples/mass-spring-damper.system.json`](docs/examples/mass-spring-damper.system.json).

System JSON includes parameters, units, equations, code, notes, and optional computed results. The same format is used for export and import so it can be generated or analyzed by an LLM.

## Plugin development

The existing plugin contracts remain available:

- [`docs/plugin-development.md`](docs/plugin-development.md)
- [`docs/cell-functions.md`](docs/cell-functions.md)
- [`docs/meta-functions.md`](docs/meta-functions.md)
- [`docs/proc-macros.md`](docs/proc-macros.md)
