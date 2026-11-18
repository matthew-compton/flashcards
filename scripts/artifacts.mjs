import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, cp, readdir, rename } from 'node:fs/promises';
import path from 'node:path';

export async function buildArtifacts(out, { define, plugins = [], release = '', production = false }) {
  const script = path.join(out, 'app.js');
  const { metafile } = await build({
    entryPoints: ['src/app.js'], outfile: script, bundle: true, format: 'esm',
    target: ['safari16', 'chrome110'], metafile: true, define, plugins
  });
  if (production) {
    for (const input of Object.keys(metafile.inputs)) {
      if (!/^(src|node_modules)\//.test(input)) throw new Error('Unexpected public bundle input: ' + input);
    }
  }
  const scriptHash = createHash('sha256').update(await readFile(script)).digest('hex').slice(0, 16);
  const scriptName = `app.${scriptHash}.js`;
  await rename(script, path.join(out, scriptName));
  const html = await readFile('src/index.html', 'utf8');
  await writeFile(path.join(out, 'index.html'), html.replace('./app.js', './' + scriptName)
    .replace('<head>', '<head>' + (release ? `<meta name="fixture-release" content="${release}">` : '')));
  await cp('src/icon.png', path.join(out, 'icon.png'));
  await writeFile(path.join(out, '.nojekyll'), '');
  await writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'Flashcards', short_name: 'Flashcards', start_url: './', scope: './', display: 'standalone',
    background_color: '#f7f6fb', theme_color: '#5b43ab',
    icons: [{ src: './icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }]
  }, null, 2));
  const assets = ['index.html', scriptName, 'icon.png', 'manifest.webmanifest'];
  const hash = createHash('sha256');
  for (const file of assets) hash.update(await readFile(path.join(out, file)));
  const worker = await readFile('src/sw.js', 'utf8');
  const revision = hash.update(worker).digest('hex').slice(0, 16);
  await writeFile(path.join(out, 'sw.js'), worker.replaceAll('__BUILD_REVISION__', revision)
    .replaceAll('__APP_SCRIPT__', scriptName));
  const allow = new Set([...assets, '.nojekyll', 'sw.js']);
  for (const file of await readdir(out)) {
    if (!allow.has(file)) throw new Error('Unexpected public asset: ' + file);
  }
}
