import { describe, expect, it } from 'vitest';
import { codexPackagedArgs } from '../../src/main/cli';

describe('Codex CLI standalone launcher arguments', () => {
  const packaged = {
    executable: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_x64__8wekyb3d8bbwe\\app\\resources\\codex.exe',
    prefixArgs: [],
  };

  it('uses the standalone transport for the WindowsApps Codex binary', () => {
    expect(codexPackagedArgs(packaged, { kind: 'codex' }, 'win32')).toEqual(['--no-daemon']);
  });

  it('does not add an unsupported flag to other binaries or agent kinds', () => {
    expect(codexPackagedArgs({ executable: 'C:\\Tools\\codex.exe', prefixArgs: [] }, { kind: 'codex' }, 'win32')).toEqual([]);
    expect(codexPackagedArgs(packaged, { kind: 'claude' }, 'win32')).toEqual([]);
    expect(codexPackagedArgs(packaged, { kind: 'codex' }, 'linux')).toEqual([]);
  });
});
