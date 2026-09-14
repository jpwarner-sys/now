/** Minimal ambient type for the artifact runtime. Everything past `use` stays `any` behind src/lib/walker.ts. */
interface Window {
  claude?: {
    use(name: string): Promise<any>;
  };
}
