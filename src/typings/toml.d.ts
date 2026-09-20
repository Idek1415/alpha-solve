declare module 'toml' {
  export function parse(input: string): any;
  export function stringify(obj: any): string;
}

