// Declaraciones mínimas de los módulos de Node usados por las pruebas
// (evitan depender de @types/node, que no está instalado).
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  export const it: typeof test;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): void;
    equal(a: unknown, b: unknown, message?: string): void;
    notEqual(a: unknown, b: unknown, message?: string): void;
    deepEqual(a: unknown, b: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, re?: RegExp, message?: string): void;
    rejects(p: Promise<unknown>, re?: RegExp): Promise<void>;
    match(s: string, re: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
declare module 'node:zlib' {
  export function inflateRawSync(b: Uint8Array): Uint8Array;
  export function deflateRawSync(b: Uint8Array): Uint8Array;
}
declare module 'node:fs' {
  export function writeFileSync(p: string, data: string | Uint8Array): void;
  export function readFileSync(p: string, enc?: string): any;
  export function mkdirSync(p: string, o?: { recursive: boolean }): void;
}
declare module 'node:child_process' {
  export function execFileSync(cmd: string, args: string[], o?: { encoding?: string; cwd?: string }): string;
}
declare module 'node:url' {
  export function fileURLToPath(u: string): string;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
interface ImportMeta { url: string }
