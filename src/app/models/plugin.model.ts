import * as toml from 'toml';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';

/**
 * Represents a reference to Python functions for solving/processing a cell
 */
export interface CellSolutionFunction {
  functionName: string;
  metaFunctionName: string;
}

/**
 * Represents a reference to Python proc macro functions
 * Proc macros modify cell content before it's processed by cell solution functions
 */
export interface ProcMacroFunction {
  functionName: string;
  metaFunctionName?: string; // Optional - if not provided, always runs at order 0
}

/**
 * Plugin containing Python code and function references for cell operations
 */
export class Plugin {
  id: string;
  name: string;
  version: string;
  pythonCode: string;
  cellSolutionFunctions: CellSolutionFunction[];
  procMacroFunctions: ProcMacroFunction[];
  pythonLibraries?: string[];

  constructor(
    id: string,
    name: string,
    version: string,
    pythonCode: string = '',
    cellSolutionFunctions: CellSolutionFunction[] = [],
    procMacroFunctions: ProcMacroFunction[] = [],
    pythonLibraries?: string[]
  ) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.pythonCode = pythonCode;
    this.cellSolutionFunctions = cellSolutionFunctions;
    this.procMacroFunctions = procMacroFunctions;
    this.pythonLibraries = pythonLibraries;
  }

  /**
   * Add a cell solution function to the plugin
   */
  addFunction(func: CellSolutionFunction): void {
    this.cellSolutionFunctions.push(func);
  }

  /**
   * Remove a cell solution function by function name
   */
  removeFunction(functionName: string): boolean {
    const index = this.cellSolutionFunctions.findIndex(f => f.functionName === functionName);
    if (index !== -1) {
      this.cellSolutionFunctions.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get a cell solution function by function name
   */
  getFunction(functionName: string): CellSolutionFunction | undefined {
    return this.cellSolutionFunctions.find(f => f.functionName === functionName);
  }

  /**
   * Serialize plugin to JSON
   */
  toJSON(): object {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      pythonCode: this.pythonCode,
      cellSolutionFunctions: this.cellSolutionFunctions,
      procMacroFunctions: this.procMacroFunctions,
      pythonLibraries: this.pythonLibraries
    };
  }

  /**
   * Create a plugin from JSON data
   */
  static fromJSON(data: any): Plugin {
    return new Plugin(
      data.id,
      data.name,
      data.version,
      data.pythonCode || '',
      data.cellSolutionFunctions || [],
      data.procMacroFunctions || [],
      data.pythonLibraries
    );
  }

  /**
   * Load a plugin from TOML configuration and Python files
   * @param tomlContent - TOML configuration as string
   * @param pythonFiles - Array of Python file contents as strings
   */
  static fromTOML(tomlContent: string, pythonFiles: string[]): Plugin {
    // Parse TOML
    const config = toml.parse(tomlContent);

    // Extract plugin metadata
    const id = config.plugin?.id || config.id || crypto.randomUUID();
    const name = config.plugin?.name || config.name || 'Untitled Plugin';
    const version = config.plugin?.version || config.version || '1.0.0';

    // Combine all Python files into one code block
    const pythonCode = pythonFiles.join('\n\n');

    // Extract cell solution functions
    const cellSolutionFunctions: CellSolutionFunction[] = [];
    const functions = config.functions || config.cellSolutionFunctions || [];

    if (Array.isArray(functions)) {
      for (const func of functions) {
        const functionName = func.functionName || func.function_name || func.name;
        const metaFunctionName = func.metaFunctionName || func.meta_function_name || func.meta || `meta_${functionName}`;

        cellSolutionFunctions.push({
          functionName,
          metaFunctionName
        });
      }
    }

    // Extract proc macro functions
    const procMacroFunctions: ProcMacroFunction[] = [];
    const procMacros = config.proc_macros || config.procMacros || [];

    if (Array.isArray(procMacros)) {
      for (const macro of procMacros) {
        const functionName = macro.functionName || macro.function_name || macro.name;
        const metaFunctionName = macro.metaFunctionName || macro.meta_function_name || macro.meta;

        procMacroFunctions.push({
          functionName,
          metaFunctionName // Can be undefined - if so, always runs at order 0
        });
      }
    }

    // Extract Python libraries from plugin section
    const pythonLibraries = config.plugin?.python_libraries;

    return new Plugin(id, name, version, pythonCode, cellSolutionFunctions, procMacroFunctions, pythonLibraries);
  }

  /**
   * Load a plugin from a git repository
   * @param gitUrl - HTTPS URL of the git repository
   */
  static async loadFromGit(gitUrl: string): Promise<Plugin> {
    // Use a unique filesystem name with timestamp to avoid caching
    const fsName = `plugin-loader-${Date.now()}`;
    const fs = new FS(fsName);
    const dir = '/plugin-repo';

    try {
      // Clone the repository
      await git.clone({
        fs,
        http,
        dir,
        url: gitUrl,
        corsProxy: 'https://cors.isomorphic-git.org',
        singleBranch: true,
        depth: 1,
        cache: {
          // Disable caching in isomorphic-git
        } as any
      });

      // Read manifest.toml
      const manifestPath = `${dir}/manifest.toml`;
      let tomlContent: string;
      try {
        const manifestData = await fs.promises.readFile(manifestPath, { encoding: 'utf8' });
        tomlContent = manifestData as string;
      } catch (error) {
        throw new Error('manifest.toml not found in repository');
      }

      // Find all .py files in the repository
      const pythonFiles: string[] = [];
      const files = await fs.promises.readdir(dir);

      for (const filename of files) {
        if (filename.endsWith('.py')) {
          const filePath = `${dir}/${filename}`;
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.isFile()) {
              const content = await fs.promises.readFile(filePath, { encoding: 'utf8' });
              pythonFiles.push(content as string);
            }
          } catch (error) {
            console.warn(`Failed to read file ${filename}:`, error);
          }
        }
      }

      return Plugin.fromTOML(tomlContent, pythonFiles);
    } catch (error: any) {
      throw new Error(`Failed to load plugin from git: ${error.message}`);
    }
  }
}

