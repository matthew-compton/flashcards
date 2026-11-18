import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildArtifacts } from '../scripts/artifacts.mjs';

test('the public build contains only its matching shell assets and excludes test data', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'flashcards-build-'));
  try {
    await buildArtifacts(folder, { define: { __SUPABASE_URL__: '""', __SUPABASE_PUBLISHABLE_KEY__: '""' }, production: true });
    const html = await readFile(path.join(folder, 'index.html'), 'utf8');
    const [, file, fingerprint] = html.match(/src="\.\/(app\.([a-f0-9]{16})\.js)"/);
    const bundle = await readFile(path.join(folder, file));
    assert.equal(createHash('sha256').update(bundle).digest('hex').slice(0, 16), fingerprint);
    const sw = await readFile(path.join(folder, 'sw.js'), 'utf8');
    assert.ok(sw.includes(file));
    assert.deepEqual((await readdir(folder)).sort(), ['.nojekyll', file, 'icon.png', 'index.html', 'manifest.webmanifest', 'sw.js']);
    assert.doesNotMatch(bundle.toString(), /flashcardsTest|fixtureLibrary|migrated-events|post-rewrite-events/);
  } finally {
    for (const file of await readdir(folder)) await unlink(path.join(folder, file));
    await rmdir(folder);
  }
});
