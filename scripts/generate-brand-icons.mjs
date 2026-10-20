#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'packages/ui/src/assets/multichamber-brand.png');
const image = await sharp(source).trim().resize(1024, 1024, { fit: 'contain', background: '#17242b' }).flatten({ background: '#17242b' }).png().toBuffer();
const png = (size) => sharp(image).resize(size, size).png().toBuffer();
const writePng = async (relative, size) => fs.writeFile(path.join(root, relative), await png(size));
const iconRoot = 'packages/electron/resources/icons';
for (const name of ['icon.png', 'dev-icon.png']) await writePng(`${iconRoot}/${name}`, 1024);
// AppImage uses the input size as its hicolor directory; 1024 is not a theme size.
await writePng(`${iconRoot}/app-icon.png`, 512);
const embedded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${image.toString('base64')}"/></svg>\n`;
for (const name of ['app-icon.svg', 'icon-win.svg', 'dev-icon-win.svg']) await fs.writeFile(path.join(root, iconRoot, name), embedded);
// PNG entries are supported by modern Windows ICO and macOS ICNS containers.
const icoImage = await png(256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(icoImage.length, 14); ico.writeUInt32LE(22, 18);
for (const name of ['icon.ico', 'dev-icon.ico']) await fs.writeFile(path.join(root, iconRoot, name), Buffer.concat([ico, icoImage]));
const chunks = [];
for (const [type, size] of [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const data = await png(size); const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(data.length + 8, 4); chunks.push(header, data);
}
const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await fs.writeFile(path.join(root, iconRoot, 'icon.icns'), Buffer.concat([icns, ...chunks]));
for (const file of await fs.readdir(path.join(root, iconRoot, 'AppIcon.icon/Assets'))) if (file.endsWith('.png')) await writePng(`${iconRoot}/AppIcon.icon/Assets/${file}`, 1024);
for (const file of await fs.readdir(path.join(root, iconRoot, 'tray'))) {
  if (!file.endsWith('.png')) continue;
  const target = path.join(root, iconRoot, 'tray', file); const metadata = await sharp(target).metadata();
  await fs.writeFile(target, await sharp(source).trim().resize(metadata.width, metadata.height, { fit: 'contain', background: '#00000000' }).png().toBuffer());
}
const publicDir = 'packages/web/public';
for (const [file, size] of [['favicon.png', 256], ['apple-touch-icon.png', 180], ['apple-touch-icon-120x120.png', 120], ['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon-180x180.png', 180], ['apple-touch-icon-167x167.png', 167], ['apple-touch-icon-152x152.png', 152]]) await writePng(`${publicDir}/${file}`, size);
for (const file of await fs.readdir(path.join(root, publicDir))) {
  if (/^(logo-|apple-touch-icon|favicon).*\.svg$/.test(file)) await fs.writeFile(path.join(root, publicDir, file), embedded);
  if (/^(logo-|icon-|pwa-).*\.png$/.test(file)) { const metadata = await sharp(path.join(root, publicDir, file)).metadata(); await writePng(`${publicDir}/${file}`, metadata.width); }
}
await writePng('packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024);
for (const directory of await fs.readdir(path.join(root, 'packages/mobile/android/app/src/main/res'))) {
  if (!directory.startsWith('mipmap-') || directory.includes('anydpi')) continue;
  const base = `packages/mobile/android/app/src/main/res/${directory}`;
  for (const file of await fs.readdir(path.join(root, base))) {
    if (!file.endsWith('.png')) continue;
    const metadata = await sharp(path.join(root, base, file)).metadata(); await writePng(`${base}/${file}`, metadata.width);
  }
}
console.log('Generated Multichamber desktop, web, and mobile icons. Recompile macOS Assets.car before packaging.');
