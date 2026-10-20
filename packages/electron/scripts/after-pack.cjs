const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { verifyPackagedAppContents } = require('./packaged-app-contents.cjs');

module.exports = (context) => {
  const resourcesPath = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  verifyPackagedAppContents(resourcesPath);
  if (context.electronPlatformName !== 'darwin') return;

  const sourceAssetsPath = path.join(__dirname, '..', 'resources', 'icons', 'Assets.car');

  if (!fs.existsSync(sourceAssetsPath)) {
    throw new Error(`Missing compiled app icon asset catalog at ${sourceAssetsPath}`);
  }

  const iconSource = path.join(__dirname, '..', 'resources', 'icons', 'AppIcon.icon');
  const inputs = [path.join(iconSource, 'icon.json'), ...fs.readdirSync(path.join(iconSource, 'Assets')).sort().map((name) => path.join(iconSource, 'Assets', name))];
  const hash = crypto.createHash('sha256');
  for (const input of inputs) hash.update(fs.readFileSync(input));
  const stamp = sourceAssetsPath + '.source-sha256';
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8').trim() !== hash.digest('hex')) {
    throw new Error('Rebuild the Multichamber macOS icon with bun run generate:macos-icon before packaging');
  }

  fs.copyFileSync(sourceAssetsPath, path.join(resourcesPath, 'Assets.car'));
};
