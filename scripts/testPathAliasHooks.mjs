// Node ESM module-resolution hook used ONLY by `npm run test:correlation`
// (registered via `--import ./scripts/registerTestPathAliases.mjs`).
//
// The app's tsconfig.json declares `"@/*": ["./src/*"]` and uses
// `"moduleResolution": "bundler"`, which lets source files import with
// extensionless, `@/`-prefixed specifiers (e.g. `from '@/lib/health/persistence'`).
// Next.js/webpack resolve that at build time. Plain Node ESM (even with
// `--experimental-strip-types`) does neither: it has no concept of the `@/`
// alias and requires explicit file extensions on relative specifiers.
//
// This hook makes `node --test` able to import real, unmodified `.ts` source
// files that use those conventions, by resolving `@/`-prefixed and relative
// extensionless specifiers against the filesystem before handing off to the
// default resolver. It does not touch tsconfig.json or any production file.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_ROOT = new URL('../src/', import.meta.url);
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'];

function isFile(fileUrl) {
  try {
    return statSync(fileURLToPath(fileUrl)).isFile();
  } catch {
    return false;
  }
}

function probe(target) {
  if (isFile(target)) return target.href;

  const filePath = fileURLToPath(target);
  for (const ext of EXTENSIONS) {
    const candidate = `${filePath}${ext}`;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  for (const ext of EXTENSIONS) {
    const candidate = `${filePath}/index${ext}`;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = probe(new URL(specifier.slice(2), SRC_ROOT));
    if (resolved) return nextResolve(resolved, context);
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const resolved = probe(new URL(specifier, context.parentURL));
    if (resolved) return nextResolve(resolved, context);
  }

  return nextResolve(specifier, context);
}
