import { mkdir, readFile, rm } from 'node:fs/promises';
import { buildArtifacts } from './artifacts.mjs';
import path from 'node:path';

let local = {};
try {
  const text = await readFile('.env', 'utf8');
  local = Object.fromEntries(text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
} catch (error) { if (error.code !== 'ENOENT') throw error; }

const url = process.env.SUPABASE_URL ?? local.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? local.SUPABASE_PUBLISHABLE_KEY ?? '';
if (key.startsWith('sb_secret_')) throw new Error('A secret Supabase key must never be used in the public app.');
if (key.includes('.')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('The public app requires an anon or publishable key.');
}
const out = path.resolve('dist');
if (path.basename(out) !== 'dist' || path.dirname(out) !== process.cwd()) throw new Error('Unexpected build directory.');
await rm(out, { recursive: true, force: true });
await mkdir(out);
await buildArtifacts(out, {
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(key) },
  production: true
});
console.log('Built the public app shell. Private decks are imported after sign-in.');
