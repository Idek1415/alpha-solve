import { Injectable } from '@angular/core';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import {
  Plugin,
  CellSolutionFunction,
  ProcMacroFunction,
  CellFunctionInput,
  CellFunctionResult,
  MetaFunctionResult,
  ProcMacroInput,
  ProcMacroResult,
  Context,
  Variable,
  CodeOutput
} from '../models';

export interface PythonExecutionResult {
  output: string;
  error?: string;
  result?: CellFunctionResult | MetaFunctionResult | ProcMacroResult;
}

export interface CodeCellExecutionResult {
  functionName: string;
  outputs: CodeOutput[];
  stdout: string;
  context: Context;
}

@Injectable({
  providedIn: 'root'
})
export class PythonExecutorService {
  private pyodide: PyodideInterface | null = null;
  private isInitialized = false;
  private plugins: Plugin[] = [];
  private functionMap: Map<string, CellSolutionFunction> = new Map();
  private procMacroMap: Map<string, ProcMacroFunction> = new Map();
  private functionPluginMap: Map<string, string> = new Map(); // Maps function name to plugin ID

  constructor() {}

  /**
   * Initialize the Python environment with a list of plugins
   */
  async initialize(plugins: Plugin[]): Promise<void> {
    if (this.isInitialized) {
      console.warn('Python executor already initialized. Reinitializing...');
    }

    // Store plugins
    this.plugins = plugins;
    this.functionMap.clear();
    this.procMacroMap.clear();
    this.functionPluginMap.clear();

    // Collect all Python libraries from plugins
    const librariesToLoad = new Set<string>();
    for (const plugin of plugins) {
      if (plugin.pythonLibraries) {
        for (const lib of plugin.pythonLibraries) {
          librariesToLoad.add(lib);
        }
      }
    }

    // Load Pyodide if not already loaded
    if (!this.pyodide) {
      console.log('Loading Pyodide...');
      this.pyodide = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/'
      });
      console.log('Pyodide loaded successfully');

      // Load Python libraries first (before alpha_solve library)
      if (librariesToLoad.size > 0) {
        try {
          const libArray = Array.from(librariesToLoad);
          console.log(`Loading Python libraries: ${libArray.join(', ')}`);
          await this.pyodide.loadPackage(libArray);
          console.log('Python libraries loaded successfully');

          // Load additional tools for specific libraries
          if (libArray.includes('sympy')) {
            await this.loadSympyTools();
          }
        } catch (error) {
          console.error('Failed to load Python libraries:', error);
          throw new Error(`Library loading failed: ${error}`);
        }
      }

      // Load the alpha_solve library
      await this.loadAlphaSolveLibrary();
    } else {
      // If Pyodide already loaded, just load any new libraries
      if (librariesToLoad.size > 0) {
        try {
          const libArray = Array.from(librariesToLoad);
          console.log(`Loading Python libraries: ${libArray.join(', ')}`);
          await this.pyodide.loadPackage(libArray);
          console.log('Python libraries loaded successfully');

          // Load additional tools for specific libraries
          if (libArray.includes('sympy')) {
            await this.loadSympyTools();
          }
        } catch (error) {
          console.error('Failed to load Python libraries:', error);
          throw new Error(`Library loading failed: ${error}`);
        }
      }
    }

    // Create plugins directory if it doesn't exist
    try {
      await this.pyodide.runPythonAsync(`
import sys
import os
if not os.path.exists('/plugins'):
    os.makedirs('/plugins')
if '/plugins' not in sys.path:
    sys.path.insert(0, '/plugins')
      `);
    } catch (error) {
      console.error('Failed to create plugins directory:', error);
      throw new Error(`Plugin directory creation failed: ${error}`);
    }

    // Write each plugin as a separate module file and import all functions
    for (const plugin of plugins) {
      if (plugin.pythonCode && plugin.pythonCode.trim()) {
        try {
          // Sanitize plugin ID for use as module name (replace invalid characters)
          const moduleId = plugin.id.replace(/[^a-zA-Z0-9_]/g, '_');
          const modulePath = `/plugins/${moduleId}.py`;

          // Write plugin code to filesystem
          this.pyodide.FS.writeFile(modulePath, plugin.pythonCode);

          // Import all functions (cell solution functions + proc macros) from the plugin module
          const cellFunctionNames = plugin.cellSolutionFunctions
            .flatMap(func => [func.functionName, func.metaFunctionName]);

          const procMacroNames = plugin.procMacroFunctions
            .flatMap(macro => {
              const names = [macro.functionName];
              if (macro.metaFunctionName) {
                names.push(macro.metaFunctionName);
              }
              return names;
            });

          const allFunctionNames = [...cellFunctionNames, ...procMacroNames].join(', ');

          if (allFunctionNames) {
            await this.pyodide.runPythonAsync(`
from ${moduleId} import ${allFunctionNames}
            `);
          }

          console.log(`Loaded plugin '${plugin.name}' as module: ${moduleId}`);
        } catch (error) {
          console.error(`Failed to load plugin '${plugin.name}':`, error);
          throw new Error(`Plugin '${plugin.name}' initialization failed: ${error}`);
        }
      }
    }

    // Build function maps from all plugins
    for (const plugin of plugins) {
      for (const func of plugin.cellSolutionFunctions) {
        this.functionMap.set(func.functionName, func);
        this.functionPluginMap.set(func.functionName, plugin.id);
        this.functionPluginMap.set(func.metaFunctionName, plugin.id);
      }

      for (const macro of plugin.procMacroFunctions) {
        this.procMacroMap.set(macro.functionName, macro);
        this.functionPluginMap.set(macro.functionName, plugin.id);
        if (macro.metaFunctionName) {
          this.functionPluginMap.set(macro.metaFunctionName, plugin.id);
        }
      }
    }

    console.log(`Registered ${this.functionMap.size} cell solution function(s) and ${this.procMacroMap.size} proc macro(s)`);
    this.isInitialized = true;
  }

  /**
   * Load the alpha_solve Python library into Pyodide as a module
   */
  private async loadAlphaSolveLibrary(): Promise<void> {
    if (!this.pyodide) return;

    try {
      // Fetch the Python library from the public folder
      const response = await fetch('/python/alpha_solve.py');
      if (!response.ok) {
        throw new Error(`Failed to fetch alpha_solve.py: ${response.statusText}`);
      }

      const libraryCode = await response.text();

      // Write the file to Pyodide's virtual filesystem
      this.pyodide.FS.writeFile('/alpha_solve.py', libraryCode);

      // Ensure the root directory is in sys.path
      await this.pyodide.runPythonAsync(`
import sys
if '/' not in sys.path:
    sys.path.insert(0, '/')
      `);

      console.log('Alpha Solve Python library loaded successfully as module');
    } catch (error) {
      console.error('Failed to load alpha_solve library:', error);
      throw error;
    }
  }

  /**
   * Load the sympy_tools Python library into Pyodide as a module
   */
  private async loadSympyTools(): Promise<void> {
    if (!this.pyodide) return;

    try {
      // Fetch the SymPy tools library from the public folder
      const response = await fetch('/python/sympy_tools.py');
      if (!response.ok) {
        throw new Error(`Failed to fetch sympy_tools.py: ${response.statusText}`);
      }

      const libraryCode = await response.text();

      // Write the file to Pyodide's virtual filesystem
      this.pyodide.FS.writeFile('/sympy_tools.py', libraryCode);

      // sys.path should already be set from loadAlphaSolveLibrary

      console.log('SymPy tools library loaded successfully as module');
    } catch (error) {
      console.error('Failed to load sympy_tools library:', error);
      throw error;
    }
  }

  /**
   * Call a cell solution function by name
   */
  async callFunction(functionName: string, input: CellFunctionInput): Promise<PythonExecutionResult> {
    if (!this.isInitialized || !this.pyodide) {
      return {
        output: '',
        error: 'Python executor not initialized. Call initialize() first.'
      };
    }

    const func = this.functionMap.get(functionName);
    if (!func) {
      return {
        output: '',
        error: `Function '${functionName}' not found in loaded plugins`
      };
    }

    try {
      // Convert input to Python-compatible format and call function
      const inputJson = JSON.stringify(input);

      // Set the JSON as a Python variable to avoid escaping issues
      this.pyodide.globals.set('input_json_str', inputJson);

      const code = `
import json
from alpha_solve import parse_input

# Parse input using alpha_solve library
input_data = parse_input(input_json_str)

# Call the function (already imported during plugin initialization)
result = ${functionName}(input_data)

# Convert result to dict and return as JSON
json.dumps(result.to_dict() if hasattr(result, 'to_dict') else result)
      `;

      const resultJson = await this.pyodide.runPythonAsync(code);
      const resultData = JSON.parse(resultJson);
      const result = CellFunctionResult.fromJSON(resultData);

      return {
        output: resultJson,
        result
      };
    } catch (error: any) {
      return {
        output: '',
        error: error.message || String(error)
      };
    }
  }

  /**
   * Call a meta function associated with a cell solution function
   */
  async callMetaFunction(functionName: string, input: CellFunctionInput): Promise<PythonExecutionResult> {
    if (!this.isInitialized || !this.pyodide) {
      return {
        output: '',
        error: 'Python executor not initialized. Call initialize() first.'
      };
    }

    const func = this.functionMap.get(functionName);
    if (!func) {
      return {
        output: '',
        error: `Function '${functionName}' not found in loaded plugins`
      };
    }

    try {
      // Convert input to Python-compatible format and call meta function
      const inputJson = JSON.stringify(input);

      // Set the JSON as a Python variable to avoid escaping issues
      this.pyodide.globals.set('input_json_str', inputJson);

      const code = `
import json
from alpha_solve import parse_input

# Parse input using alpha_solve library
input_data = parse_input(input_json_str)

# Call the meta function (already imported during plugin initialization)
result = ${func.metaFunctionName}(input_data)

# Convert result to dict and return as JSON
json.dumps(result.to_dict() if hasattr(result, 'to_dict') else result)
      `;

      const resultJson = await this.pyodide.runPythonAsync(code);
      const resultData = JSON.parse(resultJson);
      const result = MetaFunctionResult.fromJSON(resultData);

      return {
        output: resultJson,
        result
      };
    } catch (error: any) {
      return {
        output: '',
        error: error.message || String(error)
      };
    }
  }

  /**
   * Call a proc macro function by name
   */
  async callProcMacro(functionName: string, input: ProcMacroInput): Promise<PythonExecutionResult> {
    if (!this.isInitialized || !this.pyodide) {
      return {
        output: '',
        error: 'Python executor not initialized. Call initialize() first.'
      };
    }

    const macro = this.procMacroMap.get(functionName);
    if (!macro) {
      return {
        output: '',
        error: `Proc macro '${functionName}' not found in loaded plugins`
      };
    }

    try {
      // Convert input to Python-compatible format and call proc macro
      const inputJson = JSON.stringify(input);

      // Set the JSON as a Python variable to avoid escaping issues
      this.pyodide.globals.set('input_json_str', inputJson);

      const code = `
import json
from alpha_solve import parse_proc_macro_input

# Parse input using alpha_solve library
input_data = parse_proc_macro_input(input_json_str)

# Call the proc macro (already imported during plugin initialization)
result = ${functionName}(input_data)

# Convert result to dict and return as JSON
json.dumps(result.to_dict() if hasattr(result, 'to_dict') else result)
      `;

      const resultJson = await this.pyodide.runPythonAsync(code);
      const resultData = JSON.parse(resultJson);
      const result = ProcMacroResult.fromJSON(resultData);

      return {
        output: resultJson,
        result
      };
    } catch (error: any) {
      return {
        output: '',
        error: error.message || String(error)
      };
    }
  }

  /**
   * Call a meta function associated with a proc macro
   */
  async callProcMacroMetaFunction(functionName: string, input: ProcMacroInput): Promise<PythonExecutionResult> {
    if (!this.isInitialized || !this.pyodide) {
      return {
        output: '',
        error: 'Python executor not initialized. Call initialize() first.'
      };
    }

    const macro = this.procMacroMap.get(functionName);
    if (!macro) {
      return {
        output: '',
        error: `Proc macro '${functionName}' not found in loaded plugins`
      };
    }

    if (!macro.metaFunctionName) {
      // No meta function defined - return default: always use at order 0
      const defaultMeta = new MetaFunctionResult(0, '', true);
      return {
        output: JSON.stringify(defaultMeta.toJSON()),
        result: defaultMeta
      };
    }

    try {
      // Convert input to Python-compatible format and call meta function
      const inputJson = JSON.stringify(input);

      // Set the JSON as a Python variable to avoid escaping issues
      this.pyodide.globals.set('input_json_str', inputJson);

      const code = `
import json
from alpha_solve import parse_proc_macro_input

# Parse input using alpha_solve library
input_data = parse_proc_macro_input(input_json_str)

# Call the meta function (already imported during plugin initialization)
result = ${macro.metaFunctionName}(input_data)

# Convert result to dict and return as JSON
json.dumps(result.to_dict() if hasattr(result, 'to_dict') else result)
      `;

      const resultJson = await this.pyodide.runPythonAsync(code);
      const resultData = JSON.parse(resultJson);
      const result = MetaFunctionResult.fromJSON(resultData);

      return {
        output: resultJson,
        result
      };
    } catch (error: any) {
      return {
        output: '',
        error: error.message || String(error)
      };
    }
  }

  /**
   * Execute arbitrary Python code
   */
  async execute(code: string): Promise<PythonExecutionResult> {
    if (!this.isInitialized || !this.pyodide) {
      return {
        output: '',
        error: 'Python executor not initialized. Call initialize() first.'
      };
    }

    try {
      const result = await this.pyodide.runPythonAsync(code);
      return {
        output: result !== undefined && result !== null ? String(result) : ''
      };
    } catch (error: any) {
      return {
        output: '',
        error: error.message || String(error)
      };
    }
  }

  /**
   * Execute a code cell containing exactly one Python function. Function argument
   * names are resolved from the current engineering context and returned dictionary
   * keys become variables for subsequent cells.
   */
  async executeCodeCell(source: string, context: Context): Promise<CodeCellExecutionResult> {
    if (!this.isInitialized || !this.pyodide) {
      throw new Error('Python executor is not initialized.');
    }

    this.pyodide.globals.set('code_cell_source', source);
    this.pyodide.globals.set('code_cell_context_json', JSON.stringify(context));

    const resultJson = await this.pyodide.runPythonAsync(`
import ast
import contextlib
import inspect
import io
import json

tree = ast.parse(code_cell_source)
function_defs = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
if len(function_defs) != 1:
    raise ValueError("A code cell must contain exactly one top-level Python function.")

function_name = function_defs[0].name
namespace = {}
exec(compile(tree, "<alpha-solve-code-cell>", "exec"), namespace)
function = namespace[function_name]
context_data = json.loads(code_cell_context_json)

def parse_value(variable):
    values = variable.get("values", [])
    parsed = []
    for value in values:
        if not isinstance(value, str):
            parsed.append(value)
            continue
        try:
            parsed.append(ast.literal_eval(value))
        except (ValueError, SyntaxError):
            try:
                from sympy import sympify
                parsed.append(sympify(value))
            except Exception:
                parsed.append(value)
    return parsed[0] if len(parsed) == 1 else parsed

available_values = {
    variable["name"]: parse_value(variable)
    for variable in context_data.get("variables", [])
}
signature = inspect.signature(function)
arguments = {}
for parameter_name, parameter in signature.parameters.items():
    if parameter_name in available_values:
        arguments[parameter_name] = available_values[parameter_name]
    elif parameter.default is inspect.Parameter.empty:
        raise ValueError(f"Missing input variable: {parameter_name}")

stdout_buffer = io.StringIO()
with contextlib.redirect_stdout(stdout_buffer):
    function_result = function(**arguments)
    if inspect.isawaitable(function_result):
        function_result = await function_result

if not isinstance(function_result, dict):
    raise TypeError("The code cell function must return a dictionary of named outputs.")

outputs = [
    {"name": str(name), "value": str(value)}
    for name, value in function_result.items()
]

variables_by_name = {
    variable["name"]: variable
    for variable in context_data.get("variables", [])
}
for output in outputs:
    variables_by_name[output["name"]] = {
        "name": output["name"],
        "type": "analytical",
        "values": [output["value"]]
    }
    try:
        float(output["value"])
        variables_by_name[output["name"]]["type"] = "numerical"
    except (TypeError, ValueError):
        pass

json.dumps({
    "functionName": function_name,
    "outputs": outputs,
    "stdout": stdout_buffer.getvalue(),
    "context": {"variables": list(variables_by_name.values())}
})
    `);

    const data = JSON.parse(resultJson) as {
      functionName: string;
      outputs: CodeOutput[];
      stdout: string;
      context: { variables: Array<{ name: string; type: 'numerical' | 'analytical'; values: string[] }> };
    };

    return {
      functionName: data.functionName,
      outputs: data.outputs,
      stdout: data.stdout,
      context: {
        variables: data.context.variables.map(variable => Variable.fromJSON(variable))
      }
    };
  }

  /**
   * Get all loaded plugins
   */
  getPlugins(): Plugin[] {
    return [...this.plugins];
  }

  /**
   * Get all available cell solution functions
   */
  getAvailableFunctions(): CellSolutionFunction[] {
    return Array.from(this.functionMap.values());
  }

  /**
   * Get all available proc macros
   */
  getAvailableProcMacros(): ProcMacroFunction[] {
    return Array.from(this.procMacroMap.values());
  }

  /**
   * Check if a function is available
   */
  hasFunction(functionName: string): boolean {
    return this.functionMap.has(functionName);
  }

  /**
   * Check if the executor is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.pyodide !== null;
  }

  /**
   * Reset the executor (clears all loaded plugins and state)
   */
  async reset(): Promise<void> {
    this.plugins = [];
    this.functionMap.clear();
    this.procMacroMap.clear();
    this.functionPluginMap.clear();
    this.isInitialized = false;
    // Note: We keep pyodide loaded for performance
  }
}
