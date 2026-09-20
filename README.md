# Alpha Solve

Alpha Solve is a local-first engineering workspace for equations, parameters, executable Python functions, and calculated results. The interface is Angular 20 and the desktop shell is Tauri 2.

## Current product slice

- Multiple engineering systems in one workspace
- Ordered equation, Python function, and engineering-note cards
- Input parameters with descriptions and units
- Computed-variable inspection and stale-result tracking
- Existing Python/SymPy plugin solver support
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
