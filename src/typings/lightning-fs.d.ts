declare module '@isomorphic-git/lightning-fs' {
  interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }

  interface FSModule {
    promises: {
      readFile(path: string, options?: { encoding?: string }): Promise<string | Uint8Array>;
      writeFile(path: string, data: string | Uint8Array): Promise<void>;
      unlink(path: string): Promise<void>;
      readdir(path: string): Promise<string[]>;
      mkdir(path: string, options?: any): Promise<void>;
      rmdir(path: string, options?: any): Promise<void>;
      stat(path: string): Promise<Stats>;
      lstat(path: string): Promise<Stats>;
      readlink(path: string): Promise<string>;
      symlink(target: string, path: string): Promise<void>;
      chmod(path: string, mode: number): Promise<void>;
    };
  }

  class LightningFS implements FSModule {
    constructor(name: string, options?: any);
    promises: FSModule['promises'];
  }

  export default LightningFS;
}

