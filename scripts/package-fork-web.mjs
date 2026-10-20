#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageForkWeb(root, output = path.join(root, 'artifacts/fork-web')) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'multichamber-package-'));
  try {
    const web = path.join(root, 'packages/web');
    const sdk = path.join(root, 'packages/sdk');
    const manifest = JSON.parse(fs.readFileSync(path.join(web, 'package.json'), 'utf8'));
    const sdkManifest = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8'));
    if (manifest.version !== sdkManifest.version) throw new Error('Web and SDK versions must match');
    if (!fs.existsSync(path.join(web, 'dist/index.html')) || !fs.existsSync(path.join(sdk, 'dist/index.js'))) {
      throw new Error('Build web and SDK before packaging the fork');
    }
    // Use each package's allowlist, avoiding build caches and local credentials.
    for (const entry of manifest.files) {
      const source = path.join(web, entry);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(stage, entry), { recursive: true });
    }
    const bundledSdk = path.join(stage, 'node_modules/@multichamber/sdk');
    fs.mkdirSync(bundledSdk, { recursive: true });
    for (const entry of sdkManifest.files) {
      const source = path.join(sdk, entry);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(bundledSdk, entry), { recursive: true });
    }
    fs.writeFileSync(path.join(bundledSdk, 'package.json'), JSON.stringify(sdkManifest));
    manifest.dependencies['@multichamber/sdk'] = sdkManifest.version;
    manifest.bundleDependencies = ['@multichamber/sdk'];
    delete manifest.scripts.prepack;
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest));
    fs.mkdirSync(output, { recursive: true });
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
      cwd: stage, encoding: 'utf8', windowsHide: true,
    }));
    const packedArchive = path.join(output, packed[0].filename);
    const archive = path.join(output, `multichamber-web-${manifest.version}.tgz`);
    fs.renameSync(packedArchive, archive);
    fs.copyFileSync(archive, path.join(output, 'multichamber-web.tgz'));
    return archive;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(packageForkWeb(fileURLToPath(new URL('../', import.meta.url))));
}
