import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, readdir, rm, rename } from 'node:fs/promises';
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
await build({
  entryPoints: ['src/app.js'], outfile: 'dist/app.js', bundle: true, format: 'esm', minify: false,
  target: ['safari16', 'chrome110'],
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(key) }
});
const scriptHash = createHash('sha256').update(await readFile('dist/app.js')).digest('hex').slice(0, 16);
const scriptName = `app.${scriptHash}.js`;
await rename('dist/app.js', 'dist/' + scriptName);
const html = await readFile('src/index.html', 'utf8');
await writeFile('dist/index.html', html.replace('./app.js', './' + scriptName));
await cp('src/icon.png', 'dist/icon.png');
await writeFile('dist/.nojekyll', '');
await writeFile('dist/manifest.webmanifest', JSON.stringify({
  name: 'Flashcards', short_name: 'Flashcards', start_url: './', scope: './', display: 'standalone',
  background_color: '#f7f6fb', theme_color: '#5b43ab',
  icons: [{ src: './icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }]
}, null, 2));
const files = ['index.html', scriptName, 'icon.png', 'manifest.webmanifest'];
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile('dist/' + file));
const revision = hash.digest('hex').slice(0, 16);
const worker = await readFile('src/sw.js', 'utf8');
await writeFile('dist/sw.js', worker.replaceAll('__BUILD_REVISION__', revision).replaceAll('__APP_SCRIPT__', scriptName));

const allow = new Set([...files, '.nojekyll', 'sw.js']);
for (const file of await readdir(out)) {
  if (!allow.has(file)) throw new Error('Unexpected public asset: ' + file);
}
console.log('Built the public app shell. Private decks are imported after sign-in.');
