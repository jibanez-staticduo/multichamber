import { describe, expect, it, vi } from 'vitest';
import { generateCompletionScript, showHelp, showControlHelp, showStartupHelp, showConnectUrlHelp, showTunnelHelp } from './cli-args.js';
import { getPidFilePath } from './cli-process.js';

describe('fork CLI display names', () => {
  it('uses Multichamber in every help screen and preserves documented environment keys', () => {
    const output = [];
    const log = vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)); });
    try {
      for (const show of [showHelp, showControlHelp, showStartupHelp, showConnectUrlHelp, showTunnelHelp]) show();
      const text = output.join('\n');
      expect(text).toContain('Multichamber');
      expect(text).toContain('multichamber serve');
      expect(text).toContain('MULTICHAMBER_DATA_DIR');
      expect(text).not.toContain('OpenChamber');
      expect(text).not.toMatch(/\bopenchamber\s+(?:serve|tunnel|session|schedule|\[COMMAND\])/);
    } finally { log.mockRestore(); }
  });

  it('targets the fork binary in completions while retaining stable internal function names', () => {
    expect(generateCompletionScript('bash')).toContain('complete -F _openchamber_tunnel multichamber');
    expect(generateCompletionScript('zsh')).toContain('compdef _openchamber multichamber');
    expect(generateCompletionScript('fish')).toContain('complete -c multichamber');
  });

  it('keeps the compatibility pid file name', async () => {
    expect(await getPidFilePath(3210)).toContain('openchamber-3210.pid');
  });

});
