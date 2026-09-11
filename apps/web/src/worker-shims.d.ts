// Vite `?worker` import suffix typing: the specifier resolves to a module whose
// default export constructs the Worker (see apps/web/src/preview.ts).
declare module '*?worker' {
  const WorkerConstructor: new (options?: WorkerOptions) => Worker
  export default WorkerConstructor
}
