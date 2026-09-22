// Exercise the Python math regressions in the same runtime used by the app.
// Run from the repository root: node tests/run_pyodide_math_audit.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPyodide } = require('pyodide');

(async () => {
  const cdn = 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/';
  const response = await fetch(`${cdn}pyodide-lock.json`);
  if (!response.ok) throw new Error(`Runtime lock download failed: ${response.status}`);
  const pyodide = await loadPyodide({
    indexURL: path.dirname(require.resolve('pyodide')),
    lockFileContents: await response.json(),
    packageBaseUrl: cdn,
    packageCacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-solve-pyodide-audit-'))
  });
  await pyodide.loadPackage(['sympy', 'scipy']);
  pyodide.FS.mkdirTree('/audit/public/python');
  pyodide.FS.mkdirTree('/audit/tests');
  for (const file of ['public/python/sympy_tools.py', 'public/python/system_solver.py',
    'tests/test_system_solver.py', 'tests/test_math_audit.py']) {
    pyodide.FS.writeFile(`/audit/${file}`, fs.readFileSync(path.resolve(file), 'utf8'));
  }
  await pyodide.runPythonAsync(`
import unittest, sympy, scipy
print('Runtime versions:', sympy.__version__, scipy.__version__)
suite = unittest.defaultTestLoader.discover('/audit/tests')
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    raise RuntimeError('Pyodide math audit failed')
`);
})().catch(error => { console.error(error); process.exitCode = 1; });
