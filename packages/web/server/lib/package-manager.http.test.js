import http from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkForUpdates } from './package-manager.js';

let server;
let base;
let payload;
const paths = [];
const archive = Buffer.from('local Multichamber package fixture');
const fork = 'https://github.com/jibanez-staticduo/multichamber/releases';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    paths.push(req.url);
    if (req.url === '/latest') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); return; }
    if (req.url === '/download/v2.6.0/multichamber-web-2.6.0.tgz') { res.end(archive); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
const release = (assets) => ({ tag_name: 'v2.6.0', draft: false, prerelease: false, body: 'Multichamber app release', assets });

it('checks real HTTP metadata and selects the exact fork package independently of engine versions', async () => {
  paths.length = 0;
  payload = release([{ name: 'multichamber-web-2.6.0.tgz', browser_download_url: `${fork}/download/v2.6.0/multichamber-web-2.6.0.tgz`, size: archive.length }]);
  const result = await checkForUpdates({ currentVersion: '2.5.0', releaseApiUrl: base });
  expect(result).toMatchObject({ available: true, version: '2.6.0', currentVersion: '2.5.0', downloadUrl: `${fork}/download/v2.6.0/multichamber-web-2.6.0.tgz`, updateCommand: 'multichamber update' });
  const url = new URL(result.downloadUrl);
  const downloaded = await fetch(base + url.pathname.replace('/jibanez-staticduo/multichamber/releases', ''));
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(archive);
  expect(paths).toEqual(['/latest', '/download/v2.6.0/multichamber-web-2.6.0.tgz']);
});

it('rejects foreign or mismatched download metadata and a missing canonical archive', async () => {
  for (const assets of [[], [{ name: 'multichamber-web-2.6.0.tgz' }, { name: 'multichamber-web-2.6.0.tgz' }], [{ name: 'openchamber-web-2.6.0.tgz' }], [{ name: 'multichamber-web-2.6.0.tgz', browser_download_url: 'https://github.com/openchamber/openchamber/releases/download/v2.6.0/package.tgz' }], [{ name: 'multichamber-web-2.6.0.tgz', browser_download_url: `${fork}/download/v9.0.0/multichamber-web-2.6.0.tgz` }]]) {
    payload = release(assets);
    const result = await checkForUpdates({ currentVersion: '2.5.0', releaseApiUrl: base });
    expect(result.available).toBe(false); expect(result.error).toBeTruthy(); expect(result.downloadUrl).toBeUndefined();
  }
});
