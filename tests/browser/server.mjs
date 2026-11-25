import http from 'node:http';
import { mkdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifacts } from '../../scripts/artifacts.mjs';

async function buildReleases(temp) {
  const builds = new Map();
  for (const release of ['v1', 'v2']) {
    const out = path.join(temp, release);
    await mkdir(out);
    await buildArtifacts(out, {
      release,
      define: { __SUPABASE_URL__: '""', __SUPABASE_PUBLISHABLE_KEY__: '""',
        __FIXTURE_RELEASE__: JSON.stringify(release) },
      plugins: [{ name: 'test-bootstrap', setup(build) {
        build.onResolve({ filter: /^\.\/cloud\.js$/ }, () => ({ path: path.resolve('tests/browser/fixture.mjs') }));
      } }]
    });
    builds.set(release, out);
  }
  return builds;
}

function fixtureServer(builds) {
  let release = 'v1';
  let bundleUnavailable = false;
  const streams = new Map();
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      if (request.method === 'POST' && url.pathname === '/test-release' && builds.has(url.searchParams.get('version'))) {
        release = url.searchParams.get('version');
        bundleUnavailable = url.searchParams.get('bundle') === 'unavailable';
        return response.writeHead(204).end();
      }
      if (request.method === 'POST' && url.pathname === '/test-sync') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const { owner, args } = JSON.parse(body);
        const rows = streams.get(owner) ?? [];
        for (const event of args.new_events) {
          if (!rows.some(row => row.event.id === event.id)) rows.push({ revision: rows.length + 1, event });
        }
        streams.set(owner, rows);
        const events = rows.filter(row => row.revision > args.after_revision);
        return response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          .end(JSON.stringify({ events, hasMore: false }));
      }
      const file = url.pathname === '/flashcards/' ? 'index.html' : url.pathname.slice('/flashcards/'.length);
      if (!/^\/flashcards\/(?:index\.html|sw\.js|app\.[a-f0-9]+\.js|manifest\.webmanifest|icon\.png)?$/.test(url.pathname)) {
        return response.writeHead(404).end();
      }
      if (bundleUnavailable && /^app\.[a-f0-9]+\.js$/.test(file)) return response.writeHead(503).end();
      const data = await readFile(path.join(builds.get(release), file));
      return response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)], 'Cache-Control': 'no-store' }).end(data);
    } catch {
      response.writeHead(503).end();
    }
  });
}

export default async function startBrowserServer() {
  const parent = path.resolve(os.tmpdir());
  const temp = path.resolve(await mkdtemp(path.join(parent, 'flashcards-browser-')));
  if (path.dirname(temp) !== parent || !path.basename(temp).startsWith('flashcards-browser-')) {
    throw new Error('Unexpected browser fixture directory');
  }
  const removeBuilds = () => rm(temp, { recursive: true, force: true });

  try {
    const server = fixtureServer(await buildReleases(temp));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(process.env.FLASHCARDS_TEST_PORT ?? 8799), '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    return async () => {
      try {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      } finally {
        await removeBuilds();
      }
    };
  } catch (error) {
    await removeBuilds();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const stop = await startBrowserServer();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop().catch(error => {
    console.error(error);
    process.exitCode = 1;
  }));
}
