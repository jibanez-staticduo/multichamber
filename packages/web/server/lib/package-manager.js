import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_NAME = '@multichamber/web';
const LEGACY_PACKAGE_NAME = '@openchamber/web';
const PACKAGE_PATH_SEGMENTS = PACKAGE_NAME.split('/');
const GITHUB_RELEASES_URL = 'https://github.com/jibanez-staticduo/multichamber/releases';
const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/jibanez-staticduo/multichamber/releases';
const forkReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullable().optional(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.url().optional(), size: z.number().int().positive().optional() })),
});
// The reason is kept with the package manager: a later call must still tell
// a copy no package manager installed from one it did.
let cachedDetection = null;

function getSpawnSyncBaseOptions() {
  return process.platform === 'win32' ? { windowsHide: true } : {};
}
function normalizePathForComparison(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function getComparablePaths(filePath) {
  const paths = new Set();
  const normalized = normalizePathForComparison(filePath);
  if (normalized) {
    paths.add(normalized);
  }

  try {
    const realPath = fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
    const normalizedRealPath = normalizePathForComparison(realPath);
    if (normalizedRealPath) {
      paths.add(normalizedRealPath);
    }
  } catch {
  }

  return paths;
}

function pathSetContains(a, b) {
  for (const value of a) {
    if (b.has(value)) {
      return true;
    }
  }
  return false;
}

function getCurrentPackagePath() {
  return path.resolve(__dirname, '..', '..');
}

function getPackagePathForGlobalRoot(rootPath) {
  if (!rootPath) return null;
  return path.join(rootPath, ...PACKAGE_PATH_SEGMENTS);
}

function getUniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const value of paths) {
    const normalized = normalizePathForComparison(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(path.resolve(value));
  }
  return result;
}

function getCommandOutput(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      ...getSpawnSyncBaseOptions(),
    });

    if (result.status !== 0) {
      return null;
    }

    const stdout = result.stdout.trim();
    return stdout || null;
  } catch {
    return null;
  }
}

function getGlobalBinDirs(pm) {
  const pmCommand = resolvePackageManagerCommand(pm);
  if (!isCommandAvailable(pmCommand)) {
    return [];
  }

  const dirs = [];
  switch (pm) {
    case 'pnpm': {
      const pnpmBin = getCommandOutput(pmCommand, ['bin', '-g']);
      if (pnpmBin) dirs.push(pnpmBin);
      const pnpmPrefix = getCommandOutput(pmCommand, ['prefix', '-g']);
      if (pnpmPrefix) dirs.push(process.platform === 'win32' ? pnpmPrefix : path.join(pnpmPrefix, 'bin'));
      break;
    }
    case 'yarn': {
      const yarnBin = getCommandOutput(pmCommand, ['global', 'bin']);
      if (yarnBin) dirs.push(yarnBin);
      break;
    }
    case 'bun': {
      const bunBin = getCommandOutput(pmCommand, ['pm', 'bin', '-g']);
      if (bunBin) dirs.push(bunBin);
      break;
    }
    default: {
      const npmPrefix = getCommandOutput(pmCommand, ['prefix', '-g']);
      if (npmPrefix) dirs.push(process.platform === 'win32' ? npmPrefix : path.join(npmPrefix, 'bin'));
      break;
    }
  }

  return getUniquePaths(dirs);
}

function getGlobalNodeModulesRoots(pm) {
  try {
    const pmCommand = resolvePackageManagerCommand(pm);
    if (!isCommandAvailable(pmCommand)) {
      return [];
    }

    const roots = [];

    switch (pm) {
      case 'pnpm': {
        const pnpmRoot = getCommandOutput(pmCommand, ['root', '-g']);
        if (pnpmRoot) roots.push(pnpmRoot);
        const pnpmPrefix = getCommandOutput(pmCommand, ['prefix', '-g']);
        if (pnpmPrefix) roots.push(process.platform === 'win32' ? path.join(pnpmPrefix, 'node_modules') : path.join(pnpmPrefix, 'lib', 'node_modules'));
        break;
      }
      case 'yarn': {
        const yarnDir = getCommandOutput(pmCommand, ['global', 'dir']);
        if (yarnDir) roots.push(path.join(yarnDir, 'node_modules'));
        break;
      }
      case 'bun': {
        const bunBinDir = getCommandOutput(pmCommand, ['pm', 'bin', '-g']);
        if (bunBinDir) {
          roots.push(path.resolve(bunBinDir, '..', 'install', 'global', 'node_modules'));
          roots.push(path.resolve(bunBinDir, '..', '..', 'node_modules'));
        }
        break;
      }
      default:
      {
        const npmRoot = getCommandOutput(pmCommand, ['root', '-g']);
        if (npmRoot) roots.push(npmRoot);
        const npmPrefix = getCommandOutput(pmCommand, ['prefix', '-g']);
        if (npmPrefix) roots.push(process.platform === 'win32' ? path.join(npmPrefix, 'node_modules') : path.join(npmPrefix, 'lib', 'node_modules'));
        break;
      }
    }

    return getUniquePaths(roots);
  } catch {
    return [];
  }
}

function getOwnedPackagePathsFromGlobalBins(pm) {
  const packagePaths = [];
  for (const binDir of getGlobalBinDirs(pm)) {
    for (const name of ['multichamber', 'openchamber']) {
      const binaryName = process.platform === 'win32' ? `${name}.cmd` : name;
      const binaryPath = path.join(binDir, binaryName);
      if (!fs.existsSync(binaryPath)) continue;
      try {
        const realBinaryPath = fs.realpathSync.native ? fs.realpathSync.native(binaryPath) : fs.realpathSync(binaryPath);
        packagePaths.push(path.resolve(realBinaryPath, '..', '..'));
      } catch {}
    }
  }

  return getUniquePaths(packagePaths);
}

function detectPackageManagerFromCurrentInstallPath() {
  return detectPackageManagerFromInstallPath(getCurrentPackagePath());
}

function packageManagerOwnsCurrentInstall(pm) {
  const currentPackagePaths = getComparablePaths(getCurrentPackagePath());
  const candidatePackagePaths = [
    ...getGlobalNodeModulesRoots(pm).flatMap((root) => [getPackagePathForGlobalRoot(root), path.join(root, ...LEGACY_PACKAGE_NAME.split('/'))]),
    ...getOwnedPackagePathsFromGlobalBins(pm),
  ];

  for (const candidatePath of candidatePackagePaths) {
    if (!candidatePath) continue;
    if (pathSetContains(currentPackagePaths, getComparablePaths(candidatePath))) {
      return true;
    }
  }

  return false;
}

function describeDetection(packageManager, reason) {
  return {
    packageManager,
    reason,
    packagePath: getCurrentPackagePath(),
    packageManagerCommand: resolvePackageManagerCommand(packageManager),
    globalNodeModulesRoot: getGlobalNodeModulesRoots(packageManager)[0] || null,
  };
}

function rememberDetection(packageManager, reason) {
  cachedDetection = { packageManager, reason };
  return describeDetection(packageManager, reason);
}

export function detectPackageManagerDetails() {
  // In desktop (Electron) runtime, package-manager detection is worthless —
  // the app ships as a .app bundle, not installed via npm/pnpm/yarn/bun, and
  // updates are handled by electron-updater. The detection path does up to a
  // dozen spawnSync(pm, ['bin', '-g']) calls with 10s timeouts each; under
  // the in-process server every one blocks the Electron main event loop and
  // manifests as a multi-second UI freeze. Short-circuit here.
  if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
    return {
      packageManager: 'electron',
      reason: 'desktop-runtime',
      packagePath: null,
      packageManagerCommand: null,
      globalNodeModulesRoot: null,
    };
  }

  if (cachedDetection) {
    return describeDetection(cachedDetection.packageManager, cachedDetection.reason);
  }

  const forcedPm = process.env.OPENCHAMBER_PACKAGE_MANAGER?.trim();
  if (forcedPm && ['npm', 'pnpm', 'yarn', 'bun'].includes(forcedPm)) {
    if (isCommandAvailable(resolvePackageManagerCommand(forcedPm))) {
      return rememberDetection(forcedPm, 'forced-env');
    }
  }

  // First prefer the package manager that demonstrably owns the current install.
  const installPathPm = detectPackageManagerFromCurrentInstallPath();
  if (installPathPm && packageManagerOwnsCurrentInstall(installPathPm)) {
    return rememberDetection(installPathPm, 'install-path-owner');
  }

  const ownershipCandidates = ['pnpm', 'yarn', 'bun', 'npm'];
  for (const candidate of ownershipCandidates) {
    if (packageManagerOwnsCurrentInstall(candidate)) {
      return rememberDetection(candidate, 'global-root-owner');
    }
  }

  // Fall back to weaker hints only when ownership cannot be established.
  const userAgent = process.env.npm_config_user_agent || '';
  let hintedPm = null;
  if (userAgent.startsWith('pnpm')) hintedPm = 'pnpm';
  else if (userAgent.startsWith('yarn')) hintedPm = 'yarn';
  else if (userAgent.startsWith('bun')) hintedPm = 'bun';
  else if (userAgent.startsWith('npm')) hintedPm = 'npm';

  // Check execpath.
  const execPath = process.env.npm_execpath || '';
  if (!hintedPm) {
    if (execPath.includes('pnpm')) hintedPm = 'pnpm';
    else if (execPath.includes('yarn')) hintedPm = 'yarn';
    else if (execPath.includes('bun')) hintedPm = 'bun';
    else if (execPath.includes('npm')) hintedPm = 'npm';
  }

  // Detect from invoked binary path.
  const invokedPm = detectPackageManagerFromInvocationPath(process.argv?.[1]);
  if (!hintedPm) {
    hintedPm = invokedPm;
  }

  if (!hintedPm) {
    hintedPm = installPathPm;
  }

  // Validate the hint against package visibility, but only after ownership checks failed.
  if (hintedPm && isCommandAvailable(resolvePackageManagerCommand(hintedPm)) && isPackageInstalledWith(hintedPm)) {
    return rememberDetection(hintedPm, 'hinted-visible-install');
  }

  const runtimePm = detectPackageManagerFromRuntimePath(process.execPath);
  if (runtimePm && isCommandAvailable(resolvePackageManagerCommand(runtimePm)) && isPackageInstalledWith(runtimePm)) {
    return rememberDetection(runtimePm, 'runtime-visible-install');
  }

  // Last resort: pick a PM that can at least see the package.
  const pmChecks = [
    { name: 'pnpm', check: () => isCommandAvailable(resolvePackageManagerCommand('pnpm')) },
    { name: 'yarn', check: () => isCommandAvailable(resolvePackageManagerCommand('yarn')) },
    { name: 'bun', check: () => isCommandAvailable(resolvePackageManagerCommand('bun')) },
    { name: 'npm', check: () => isCommandAvailable(resolvePackageManagerCommand('npm')) },
  ];

  for (const { name, check } of pmChecks) {
    if (check()) {
      // Verify this PM actually has the package installed globally
      if (isPackageInstalledWith(name)) {
        return rememberDetection(name, 'last-resort-visible-install');
      }
    }
  }

  // npm is only a guess from here on. A copy outside any node_modules folder
  // (an unpacked tarball, the Docker image, a source checkout) was installed
  // by no package manager at all, so no install command updates it.
  return rememberDetection('npm', installPathPm ? 'default-fallback' : 'unmanaged-install');
}

/** The running copy was installed by no package manager, so it cannot update itself. */
export function isUnmanagedInstall() {
  return (cachedDetection ?? detectPackageManagerDetails()).reason === 'unmanaged-install';
}

export function detectPackageManager() {
  return detectPackageManagerDetails().packageManager;
}

function detectPackageManagerFromInstallPath(pkgPath) {
  if (!pkgPath) return null;
  const normalized = pkgPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.pnpm/') || normalized.includes('/pnpm/')) return 'pnpm';
  if (normalized.includes('/.yarn/')) return 'yarn';
  if (normalized.includes('/.bun/') || normalized.includes('/bun/install/')) return 'bun';
  if (normalized.includes('/node_modules/')) return 'npm';
  return null;
}

function detectPackageManagerFromRuntimePath(runtimePath) {
  if (!runtimePath || typeof runtimePath !== 'string') return null;
  const normalized = runtimePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.bun/bin/bun') || normalized.endsWith('/bun') || normalized.endsWith('/bun.exe')) {
    return 'bun';
  }
  if (normalized.includes('/pnpm/')) return 'pnpm';
  if (normalized.includes('/yarn/')) return 'yarn';
  if (normalized.includes('/node') || normalized.endsWith('/node.exe')) return 'npm';
  return null;
}

function detectPackageManagerFromInvocationPath(invokedPath) {
  if (!invokedPath || typeof invokedPath !== 'string') return null;
  const normalized = invokedPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.bun/bin/')) return 'bun';
  if (normalized.includes('/.pnpm/')) return 'pnpm';
  if (normalized.includes('/.yarn/')) return 'yarn';
  return null;
}

function getPackageManagerCommandCandidates(pm) {
  const candidates = [];
  if (pm === 'bun') {
    const bunExecutable = process.platform === 'win32' ? 'bun.exe' : 'bun';
    if (process.env.BUN_INSTALL) {
      candidates.push(path.join(process.env.BUN_INSTALL, 'bin', bunExecutable));
    }
    if (process.env.HOME) {
      candidates.push(path.join(process.env.HOME, '.bun', 'bin', bunExecutable));
    }
    if (process.env.USERPROFILE) {
      candidates.push(path.join(process.env.USERPROFILE, '.bun', 'bin', bunExecutable));
    }
  }
  candidates.push(pm);
  return [...new Set(candidates.filter(Boolean))];
}

function resolvePackageManagerCommand(pm) {
  const candidates = getPackageManagerCommandCandidates(pm);
  for (const candidate of candidates) {
    if (isCommandAvailable(candidate)) {
      return candidate;
    }
  }
  return pm;
}

function quoteCommand(command) {
  if (!command) return command;
  if (!/\s/.test(command)) return command;
  if (process.platform === 'win32') {
    return `"${command.replace(/"/g, '""')}"`;
  }
  return `'${command.replace(/'/g, "'\\''")}'`;
}

function isCommandAvailable(command) {
  try {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      ...getSpawnSyncBaseOptions(),
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function getGlobalListArgs(pm) {
  switch (pm) {
    case 'pnpm':
      return ['list', '-g', '--depth=0', PACKAGE_NAME];
    case 'yarn':
      return ['global', 'list', '--depth=0'];
    case 'bun':
      return ['pm', 'ls', '-g'];
    default:
      return ['list', '-g', '--depth=0', PACKAGE_NAME];
  }
}

function isPackageInstalledWith(pm) {
  try {
    const pmCommand = resolvePackageManagerCommand(pm);
    const args = getGlobalListArgs(pm);

    const result = spawnSync(pmCommand, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      ...getSpawnSyncBaseOptions(),
    });

    if (result.status !== 0) return false;
    return result.stdout.includes(PACKAGE_NAME) || result.stdout.includes(LEGACY_PACKAGE_NAME);
  } catch {
    return false;
  }
}

// npm, bun and yarn print `name@version`; pnpm separates the name and the
// version with whitespace. An optional `v` covers yarn listing formats.
const GLOBAL_VERSION_PATTERN = /@multichamber\/web[@\s]+v?(\d[\w.+-]*)/;

/**
 * Read the globally installed version of the package as reported by the
 * package manager itself. Returns null when the listing cannot be read or
 * parsed. The listing command may exit non-zero when the package is missing,
 * so stdout is parsed regardless of the status.
 */
function getInstalledGlobalVersion(pm) {
  try {
    const pmCommand = resolvePackageManagerCommand(pm);
    const result = spawnSync(pmCommand, getGlobalListArgs(pm), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      ...getSpawnSyncBaseOptions(),
    });
    return String(result.stdout || '').match(GLOBAL_VERSION_PATTERN)?.[1] || null;
  } catch {
    return null;
  }
}

/**
 * Normalize a version string into an exact install target.
 * Returns the plain version or null when the value is not a concrete version.
 */
function normalizeTargetVersion(value) {
  const normalized = String(value ?? '').trim().replace(/^v/, '');
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized) ? normalized : null;
}

// Dependencies whose install scripts pnpm 10+ blocks until approved. pnpm 11+
// stops a global install in a terminal to ask about them. Keep in sync with
// scripts/install.sh and with the "Ignored build scripts" list a fresh
// `pnpm add -g @multichamber/web` prints.
const PNPM_BUILD_DEPENDENCIES = ['msgpackr-extract', 'node-pty'];
// First pnpm release that accepts `--allow-build`; older ones reject it as an
// unknown option, and pnpm 9 and older run build scripts without approval.
const PNPM_ALLOW_BUILD_MIN_VERSION = '10.4.0';

function getPnpmAllowBuildFlags(pmCommand) {
  const version = normalizeTargetVersion(getCommandOutput(pmCommand, ['--version']));
  if (!version || compareVersions(version, PNPM_ALLOW_BUILD_MIN_VERSION) < 0) return '';
  return PNPM_BUILD_DEPENDENCIES.map((name) => ` --allow-build=${name}`).join('');
}

/**
 * Get the update command for the detected package manager.
 * When an exact target version is given, it is pinned in the spec instead of
 * re-resolving the `latest` dist-tag at install time: the update check and the
 * package manager see different metadata, and dist-tag resolution can lag the
 * check behind a fresh release (stale packument cache, pnpm minimumReleaseAge).
 */
export function getUpdateCommand(pm = detectPackageManager(), options = {}) {
  const targetVersion = normalizeTargetVersion(options.targetVersion);
  if (options.targetVersion != null && !targetVersion) {
    throw new Error(`Invalid target version for update: ${String(options.targetVersion)}`);
  }
  const archiveUrl = targetVersion
    ? `${GITHUB_RELEASES_URL}/download/v${targetVersion}/multichamber-web-${targetVersion}.tgz`
    : `${GITHUB_RELEASES_URL}/latest/download/multichamber-web.tgz`;
  const versionSpec = quoteCommand(archiveUrl);
  const resolvedCommand = resolvePackageManagerCommand(pm);
  const pmCommand = quoteCommand(resolvedCommand);
  switch (pm) {
    case 'pnpm':
      return `${pmCommand} add -g${getPnpmAllowBuildFlags(resolvedCommand)} ${versionSpec}`;
    case 'yarn':
      return `${pmCommand} global add ${versionSpec}`;
    case 'bun':
      return `${pmCommand} add -g ${versionSpec}`;
    default:
      return `${pmCommand} install -g ${versionSpec}`;
  }
}

/**
 * Get current installed version from package.json
 */
export function getCurrentVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Compare semver-like version strings.
 */
function parseVersionForComparison(value) {
  const normalized = String(value || '').replace(/^v/, '').split('+')[0];
  const prereleaseIndex = normalized.indexOf('-');
  const core = prereleaseIndex >= 0 ? normalized.slice(0, prereleaseIndex) : normalized;
  const parts = core.split('.').map((part) => {
    const parsed = Number.parseInt(part || '0', 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  return {
    parts,
    prerelease: prereleaseIndex >= 0,
  };
}

function compareVersions(left, right) {
  const a = parseVersionForComparison(left);
  const b = parseVersionForComparison(right);
  const length = Math.max(a.parts.length, b.parts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0);
    if (diff !== 0) return diff;
  }

  if (a.prerelease !== b.prerelease) {
    return a.prerelease ? -1 : 1;
  }

  return 0;
}

/** Checks only the Multichamber release feed. A failed check never falls back to upstream. */
export async function checkForUpdates(options = {}) {
  const currentVersion = options.currentVersion || getCurrentVersion();
  const pm = detectPackageManager();
  try {
    if (currentVersion === 'unknown') throw new Error('Unable to determine installed version');
    const response = await (options.fetchImpl ?? fetch)(`${options.releaseApiUrl ?? GITHUB_RELEASES_API_URL}/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Multichamber release feed responded with ${response.status}`);
    const release = forkReleaseSchema.parse(await response.json());
    const version = normalizeTargetVersion(release.tag_name);
    if (!version || release.draft || release.prerelease) throw new Error('Invalid stable Multichamber release');
    const assets = release.assets;
    const available = compareVersions(version, currentVersion) > 0;
    const webArchives = assets.filter((asset) => asset.name === `multichamber-web-${version}.tgz`);
    if (webArchives.length > 1) throw new Error('Multichamber release has duplicate web package archives');
    const webArchive = webArchives[0];
    if (available && (!options.appType || options.appType === 'web') && !webArchive) {
      throw new Error('Multichamber release has no web package archive');
    }
    const webDownloadUrl = `${GITHUB_RELEASES_URL}/download/v${version}/multichamber-web-${version}.tgz`;
    if (webArchive?.browser_download_url && webArchive.browser_download_url !== webDownloadUrl) throw new Error('Multichamber release has an invalid web archive URL');
    const apk = assets.find((asset) => /^Multichamber-.+-android\.apk$/i.test(asset.name));
    const apkDownloadUrl = apk ? `${GITHUB_RELEASES_URL}/download/v${version}/${encodeURIComponent(apk.name)}` : undefined;
    if (apk?.browser_download_url && apk.browser_download_url !== apkDownloadUrl) throw new Error('Multichamber release has an invalid Android archive URL');
    return {
      available,
      version,
      currentVersion,
      body: release.body ?? undefined,
      releaseUrl: `${GITHUB_RELEASES_URL}/tag/v${version}`,
      downloadUrl: available && options.appType === 'mobile-capacitor' && options.platform === 'android'
        ? apkDownloadUrl
        : available && (!options.appType || options.appType === 'web') ? webDownloadUrl : undefined,
      packageManager: pm,
      updateCommand: 'multichamber update',
    };
  } catch (error) {
    return { available: false, currentVersion, error: error.message || 'Unable to check Multichamber releases' };
  }
}

/**
 * Execute the update (used by CLI).
 * When an exact target version is given, the globally installed version is
 * read back after the package manager exits: a zero exit status alone is not
 * proof the target landed (stale dist-tag resolution, pnpm release-age policy),
 * and the caller must not report success without the version matching.
 */
export function executeUpdate(pm = detectPackageManager(), options = {}) {
  const command = getUpdateCommand(pm, { targetVersion: options.targetVersion });
  if (!options?.silent) {
    console.log(`Updating ${PACKAGE_NAME} using ${pm}...`);
    console.log(`Running: ${command}`);
  }

  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    ...getSpawnSyncBaseOptions(),
  });

  if (result.status !== 0) {
    return {
      success: false,
      exitCode: result.status,
      error: `Package manager exited with code ${result.status}`,
    };
  }

  const targetVersion = normalizeTargetVersion(options.targetVersion);
  if (!targetVersion) {
    return {
      success: true,
      exitCode: result.status,
      installedVersion: null,
    };
  }

  const installedVersion = getInstalledGlobalVersion(pm);
  if (!installedVersion) {
    return {
      success: false,
      exitCode: result.status,
      error: `Could not determine the globally installed ${PACKAGE_NAME} version after the update; not reporting success`,
    };
  }

  if (compareVersions(installedVersion, targetVersion) !== 0) {
    return {
      success: false,
      exitCode: result.status,
      error: `Installed ${PACKAGE_NAME} version ${installedVersion} does not match target ${targetVersion}. The package manager may have resolved different metadata or filtered the release.`,
    };
  }

  return {
    success: true,
    exitCode: result.status,
    installedVersion,
  };
}
