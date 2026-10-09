// Builds the extension for tests/extension.spec.js, into a temp folder (never
// dist/), with addresses that cannot resolve (.invalid is reserved, RFC 2606):
// the tests answer every call with stubs, and a call they forgot fails instead
// of reaching a real project or the live API. Variables set here win over the
// repo's .env: Vite reads the process environment first.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_DIR = path.join(os.tmpdir(), 'onextap-e2e-extension');

export const EXTENSION_ENV = {
  VITE_SUPABASE_URL: 'https://e2e.invalid',
  VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
  VITE_API_URL: 'https://api.e2e.invalid',
  VITE_DASHBOARD_URL: 'http://localhost:5173'
};

export default function buildExtension() {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build', '--outDir', EXTENSION_DIR, '--emptyOutDir', '--logLevel', 'warn'
  ], { cwd: root, env: { ...process.env, ...EXTENSION_ENV }, stdio: 'inherit' });
}
