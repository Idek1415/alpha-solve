declare module 'pyodide' {
  export interface PyodideFS {
    writeFile(path: string, data: string | Uint8Array, opts?: any): void;
    readFile(path: string, opts?: any): string | Uint8Array;
    unlink(path: string): void;
    mkdir(path: string): void;
    rmdir(path: string): void;
  }

  export interface PyodideInterface {
    runPython(code: string): any;
    runPythonAsync(code: string): Promise<any>;
    loadPackage(packages: string | string[]): Promise<void>;
    globals: any;
    FS: PyodideFS;
  }

  export interface LoadPyodideOptions {
    indexURL?: string;
    fullStdLib?: boolean;
    stdin?: () => string;
    stdout?: (msg: string) => void;
    stderr?: (msg: string) => void;
  }

  export function loadPyodide(options?: LoadPyodideOptions): Promise<PyodideInterface>;
}

