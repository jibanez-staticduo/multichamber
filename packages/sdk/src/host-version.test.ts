import { describe, expect, test } from 'bun:test';

import {
  compareMultichamberVersions,
  hostMeetsMultichamberEngine,
  multichamberEngineMinimum,
  parseMultichamberVersion,
} from './host-version.ts';

describe('multichamber host version', () => {
  test('parses core semver', () => {
    expect(parseMultichamberVersion('1.22.0')).toEqual({ major: 1, minor: 22, patch: 0 });
    expect(parseMultichamberVersion('v1.22.0-beta.1')).toEqual({ major: 1, minor: 22, patch: 0 });
    expect(parseMultichamberVersion('junk')).toBeNull();
  });

  test('compares versions', () => {
    expect(compareMultichamberVersions('1.22.0', '1.21.9')).toBeGreaterThan(0);
    expect(compareMultichamberVersions('1.22.0', '1.22.0')).toBe(0);
    expect(compareMultichamberVersions('1.21.0', '1.22.0')).toBeLessThan(0);
  });

  test('normalizes engines.openchamber floors', () => {
    expect(multichamberEngineMinimum('1.22.0')).toBe('1.22.0');
    expect(multichamberEngineMinimum('>=1.22.0')).toBe('1.22.0');
    expect(multichamberEngineMinimum('^1.22.0')).toBeNull();
  });

  test('checks host against engines.openchamber', () => {
    expect(hostMeetsMultichamberEngine('1.22.0', '>=1.22.0')).toBe(true);
    expect(hostMeetsMultichamberEngine('1.22.0', '1.22.0')).toBe(true);
    expect(hostMeetsMultichamberEngine('1.21.9', '>=1.22.0')).toBe(false);
    expect(hostMeetsMultichamberEngine('unknown', '>=1.22.0')).toBe(false);
  });
});
