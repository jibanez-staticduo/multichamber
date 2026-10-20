import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

// Mock child_process to prevent real spawnSync calls that would hang in tests
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '/usr/local/bin', stderr: '' })),
}));

const {
  checkForUpdates,
  detectPackageManager,
  executeUpdate,
  getCurrentVersion,
  getUpdateCommand,
} = await import('./package-manager.js');

describe('checkForUpdates', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const release = (extra = {}) => ({
    tag_name: 'v1.10.0', body: 'Fork changes', draft: false, prerelease: false,
    assets: [{ name: 'multichamber-web-1.10.0.tgz' }, { name: 'Multichamber-1.10.0-42-android.apk' }],
    ...extra,
  });
  const feed = (payload, status = 200) => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: status === 200, status, json: async () => payload };
    };
    return calls;
  };

  it('uses fork releases without sending usage or consulting upstream', async () => {
    const calls = feed(release());
    const result = await checkForUpdates({ currentVersion: '1.9.10', installId: 'private-id' });
    expect(result.available).toBe(true);
    expect(result.version).toBe('1.10.0');
    expect(result.releaseUrl).toBe('https://github.com/jibanez-staticduo/multichamber/releases/tag/v1.10.0');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/repos/jibanez-staticduo/multichamber/releases/latest');
    expect(calls[0].options.body).toBeUndefined();
  });

  it('resolves the Android download from fork assets', async () => {
    feed(release());
    const result = await checkForUpdates({ currentVersion: '1.9.10', appType: 'mobile-capacitor', platform: 'android' });
    expect(result.downloadUrl).toBe('https://github.com/jibanez-staticduo/multichamber/releases/download/v1.10.0/Multichamber-1.10.0-42-android.apk');
  });

  it('does not offer an iOS APK or downgrade the installed version', async () => {
    feed(release());
    const result = await checkForUpdates({ currentVersion: '1.11.0', appType: 'mobile-capacitor', platform: 'ios' });
    expect(result.available).toBe(false);
    expect(result.downloadUrl).toBeUndefined();
  });

  it('fails explicitly on unavailable, invalid, prerelease or incomplete release metadata', async () => {
    for (const [payload, status] of [
      [release(), 404], [release({ tag_name: 'invalid' }), 200],
      [release({ prerelease: true }), 200], [release({ draft: true }), 200],
      [release({ assets: [] }), 200],
    ]) {
      const calls = feed(payload, status);
      const result = await checkForUpdates({ currentVersion: '1.9.10' });
      expect(result.available).toBe(false);
      expect(result.error).toBeTruthy();
      expect(calls).toHaveLength(1);
    }
  });

  it('preserves network failures as errors', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    expect(await checkForUpdates({ currentVersion: '1.9.10' })).toMatchObject({ available: false, error: 'offline' });
  });
});

describe('getCurrentVersion', () => {
  it('is exported for the CLI update command', () => {
    expect(typeof getCurrentVersion).toBe('function');
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+|unknown$/);
  });
});

describe('getUpdateCommand', () => {
  it('pins the exact target version instead of re-resolving the latest dist-tag', () => {
    expect(getUpdateCommand('npm', { targetVersion: '1.24.1' })).toBe('npm install -g https://github.com/jibanez-staticduo/multichamber/releases/download/v1.24.1/multichamber-web-1.24.1.tgz');
    expect(getUpdateCommand('pnpm', { targetVersion: 'v1.24.1' })).toBe('pnpm add -g https://github.com/jibanez-staticduo/multichamber/releases/download/v1.24.1/multichamber-web-1.24.1.tgz');
    expect(getUpdateCommand('yarn', { targetVersion: '1.24.1' })).toBe('yarn global add https://github.com/jibanez-staticduo/multichamber/releases/download/v1.24.1/multichamber-web-1.24.1.tgz');
    expect(getUpdateCommand('bun', { targetVersion: '1.25.0-beta.1' })).toContain('add -g https://github.com/jibanez-staticduo/multichamber/releases/download/v1.25.0-beta.1/multichamber-web-1.25.0-beta.1.tgz');
  });

  describe('pnpm build approvals', () => {
    function stubPnpmVersion(stdout, status = 0) {
      spawnSync.mockImplementation((command, args) => (
        Array.isArray(args) && args[0] === '--version'
          ? { status, stdout, stderr: '' }
          : { status: 0, stdout: '', stderr: '' }
      ));
    }

    afterEach(() => {
      spawnSync.mockReset();
    });

    it('pre-approves the dependency builds on pnpm 10.4 and newer', () => {
      for (const version of ['10.4.0', '10.34.6', '11.28.2', '12.11.2']) {
        stubPnpmVersion(`${version}\n`);
        expect(getUpdateCommand('pnpm', { targetVersion: '1.24.1' })).toBe(
          'pnpm add -g --allow-build=msgpackr-extract --allow-build=node-pty https://github.com/jibanez-staticduo/multichamber/releases/download/v1.24.1/multichamber-web-1.24.1.tgz',
        );
      }
    });

    it('leaves the flag out where pnpm rejects it or the version is unknown', () => {
      for (const version of ['9.15.9', '10.3.0', '']) {
        stubPnpmVersion(`${version}\n`);
        expect(getUpdateCommand('pnpm', { targetVersion: '1.24.1' })).toBe('pnpm add -g https://github.com/jibanez-staticduo/multichamber/releases/download/v1.24.1/multichamber-web-1.24.1.tgz');
      }
      stubPnpmVersion('', 1);
      expect(getUpdateCommand('pnpm', { targetVersion: '1.24.1' })).toBe('pnpm add -g https://github.com/jibanez-staticduo/multichamber/releases/download/v1.24.1/multichamber-web-1.24.1.tgz');
    });
  });

  it('falls back to the latest dist-tag when no target version is given', () => {
    expect(getUpdateCommand('npm')).toBe('npm install -g https://github.com/jibanez-staticduo/multichamber/releases/latest/download/multichamber-web.tgz');
  });

  it('rejects a target version that is not a concrete version', () => {
    expect(() => getUpdateCommand('npm', { targetVersion: 'latest; rm -rf /' })).toThrow(/Invalid target version/);
  });
});

describe('executeUpdate', () => {
  function stubSpawnSync({ installStatus = 0, listingStdout = '', listingStatus = 0 } = {}) {
    spawnSync.mockImplementation((command, args) => {
      if (!Array.isArray(args)) {
        return { status: installStatus, stdout: '', stderr: '' };
      }
      if (args.includes('--version')) {
        return { status: 0, stdout: '10.0.0', stderr: '' };
      }
      if (args[0] === 'list' || args[0] === 'pm' || args[0] === 'global') {
        return { status: listingStatus, stdout: listingStdout, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
  }

  afterEach(() => {
    spawnSync.mockReset();
  });

  it('reports success when the installed version matches the target', () => {
    stubSpawnSync({ listingStdout: '└── @multichamber/web@1.24.1' });
    const result = executeUpdate('npm', { targetVersion: '1.24.1' });
    expect(result.success).toBe(true);
    expect(result.installedVersion).toBe('1.24.1');
  });

  it('fails when the package manager exits non-zero', () => {
    stubSpawnSync({ installStatus: 1 });
    const result = executeUpdate('npm', { targetVersion: '1.24.1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('exited with code 1');
  });

  it('fails when the package manager exits successfully but installed the wrong version', () => {
    stubSpawnSync({ listingStdout: '└── @multichamber/web@1.19.0' });
    const result = executeUpdate('npm', { targetVersion: '1.24.1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('1.19.0');
    expect(result.error).toContain('1.24.1');
  });

  it('fails loudly when the installed version cannot be verified', () => {
    stubSpawnSync({ listingStdout: '', listingStatus: 1 });
    const result = executeUpdate('npm', { targetVersion: '1.24.1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not determine');
  });

  it('keeps the previous behavior when no target version is given', () => {
    stubSpawnSync();
    const result = executeUpdate('npm');
    expect(result.success).toBe(true);
    expect(result.installedVersion).toBeNull();
  });
});

describe('detectPackageManagerDetails', () => {
  afterEach(() => {
    spawnSync.mockReset();
    vi.unstubAllEnvs();
  });

  it('keeps reporting a copy no package manager installed after the first detection', async () => {
    vi.stubEnv('OPENCHAMBER_RUNTIME', '');
    vi.stubEnv('OPENCHAMBER_PACKAGE_MANAGER', '');
    // No package manager answers, as on a server where an unpacked tarball runs.
    spawnSync.mockImplementation(() => ({ status: 1, stdout: '', stderr: '' }));
    vi.resetModules();
    const { detectPackageManagerDetails, isUnmanagedInstall } = await import('./package-manager.js');

    expect(detectPackageManagerDetails().reason).toBe('unmanaged-install');
    expect(detectPackageManagerDetails().reason).toBe('unmanaged-install');
    expect(isUnmanagedInstall()).toBe(true);
  });
});

describe('CLI update exports', () => {
  it('exports package-manager helpers used by the update command', () => {
    expect(typeof detectPackageManager).toBe('function');
    expect(typeof executeUpdate).toBe('function');
  });
});
