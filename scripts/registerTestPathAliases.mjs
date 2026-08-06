// Entry point passed to `node --import` for `npm run test:correlation`.
// Registers the `@/` / extensionless-specifier resolution hook in
// ./testPathAliasHooks.mjs so plain `node --test` can import real source
// files (e.g. src/lib/health/ouraSyncEngine.ts) that rely on Next.js's
// bundler-style module resolution.
import { register } from 'node:module';

register('./testPathAliasHooks.mjs', import.meta.url);
