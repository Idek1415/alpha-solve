declare module 'isomorphic-git' {
  export function clone(options: any): Promise<void>;
  export function checkout(options: any): Promise<void>;
  export function listFiles(options: any): Promise<string[]>;
}

declare module 'isomorphic-git/http/web' {
  const http: any;
  export default http;
}

