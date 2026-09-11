// Barrel export. Each bounded context is re-exported under its own namespace
// so a consumer writes `import { identity } from '@fp/core'` rather than
// reaching into a context's internal file layout.
export * as identity from './identity/index.js';
