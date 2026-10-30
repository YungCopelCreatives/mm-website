// Bundles the pinned Firebase and Supabase SDKs into self-hosted ES modules under /vendor.
// Versions are pinned exactly in package.json devDependencies. Run: npm run build:vendor
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fbVersion = require('firebase/package.json').version;
const sbVersion = require('@supabase/supabase-js/package.json').version;
mkdirSync('vendor', { recursive: true });

const entries = {
  'firebase.js': `export * from 'firebase/app';\nexport * from 'firebase/auth';\nexport * from 'firebase/app-check';\n`,
  'supabase.js': `export { createClient } from '@supabase/supabase-js';\n`,
};
for (const [out, contents] of Object.entries(entries)) {
  await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, format: 'esm', minify: true, target: 'es2020', platform: 'browser',
    legalComments: 'eof', outfile: `vendor/${out}`,
    banner: { js: `/* ${out === 'firebase.js' ? `firebase@${fbVersion}` : `@supabase/supabase-js@${sbVersion}`} (bundled by scripts/build-vendor.mjs) */` },
  });
}
writeFileSync('vendor/VERSIONS.json', JSON.stringify({ firebase: fbVersion, '@supabase/supabase-js': sbVersion }, null, 2) + '\n');
console.log('vendor built', { firebase: fbVersion, supabase: sbVersion });
