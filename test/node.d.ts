// Minimal Node typing for test/design.test.ts (avoids adding @types/node).
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
interface ImportMeta {
  url: string;
}
