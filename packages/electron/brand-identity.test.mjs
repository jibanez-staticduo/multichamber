import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('desktop install identity and profile remain separate from upstream', () => {
  const manifest = JSON.parse(read('./package.json'));
  assert.equal(manifest.build.appId, 'com.staticduo.multichamber');
  assert.equal(manifest.build.productName, 'Multichamber');
  assert.equal(manifest.build.win.executableName, 'Multichamber');
  assert.equal(manifest.build.linux.executableName, 'multichamber');
  assert.equal(manifest.build.linux.desktop.entry.StartupWMClass, 'multichamber');
  const entry = read('./entry.mjs');
  assert.match(entry, /app\.setName\('Multichamber'\)/);
  assert.match(entry, /'Multichamber Dev'/);
  const early = read('./early-startup.mjs');
  assert.match(early, /DEEP_LINK_PROTOCOL = 'multichamber'/);
  assert.match(early, /PACKAGED_APP_USER_MODEL_ID = 'com\.staticduo\.multichamber'/);
  assert.match(early, /'\.config', 'multichamber', 'settings\.json'/);
});

test('native mobile bundle identity cannot overwrite upstream installations', () => {
  const capacitor = JSON.parse(read('../mobile/capacitor.config.json'));
  assert.equal(capacitor.appId, 'com.staticduo.multichamber');
  assert.equal(capacitor.appName, 'Multichamber');
  assert.match(read('../mobile/android/app/build.gradle'), /applicationId "com\.staticduo\.multichamber"/);
  const project = read('../mobile/ios/App/App.xcodeproj/project.pbxproj');
  assert.doesNotMatch(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.openchamber\.app/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.staticduo\.multichamber;/);
  assert.match(read('../mobile/ios/App/App/App.entitlements'), /group\.com\.staticduo\.multichamber/);
});
