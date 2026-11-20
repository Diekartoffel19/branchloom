import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeAudio } from '../../src/main/voice/transcribe';

function fakeProcess(reply: object) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  child.stdin.on('finish', () => {
    child.stdout.write(JSON.stringify(reply));
    child.emit('close', 0);
  });
  return child;
}

describe('local speech transcription', () => {
  afterEach(() => vi.useRealTimers());
  it('rejects invalid audio before starting Python', async () => {
    const spawnProcess = vi.fn();
    await expect(transcribeAudio(new Uint8Array(99), { spawnProcess: spawnProcess as never }))
      .rejects.toThrow('100 Byte');
    await expect(transcribeAudio(new Uint8Array(8 * 1024 * 1024 + 1), { spawnProcess: spawnProcess as never }))
      .rejects.toThrow('8 MiB');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('passes the clip in memory to Python without a shell or network model download', async () => {
    const child = fakeProcess({ text: 'Hallo Jarvis' });
    const spawnProcess = vi.fn(() => child);
    const audio = new Uint8Array(200).fill(7);
    const received: Buffer[] = [];
    child.stdin.on('data', (part: Buffer) => received.push(part));

    await expect(transcribeAudio(audio, {
      python: 'python-test', modelDirectory: 'C:\\models', spawnProcess: spawnProcess as never,
    })).resolves.toBe('Hallo Jarvis');
    expect(Buffer.concat(received)).toEqual(Buffer.from(audio));
    expect(spawnProcess).toHaveBeenCalledWith('python-test', expect.arrayContaining(['-c', 'C:\\models']),
      expect.objectContaining({ shell: false, windowsHide: true }));
    const workerSource = spawnProcess.mock.calls[0]?.[1]?.[1] as string;
    expect(workerSource).toContain('local_files_only=True');
  });

  it('returns a missing-model setup error from the local worker', async () => {
    const spawnProcess = vi.fn(() => fakeProcess({ error: 'Whisper-Modell fehlt. Bitte die lokale Spracheinrichtung ausführen.' }));
    await expect(transcribeAudio(new Uint8Array(200), { modelDirectory: 'C:\\models', spawnProcess: spawnProcess as never }))
      .rejects.toThrow('Whisper-Modell fehlt');
  });

  it('refuses a relative model directory', async () => {
    await expect(transcribeAudio(new Uint8Array(200), { modelDirectory: './model' }))
      .rejects.toThrow('absoluter Pfad');
  });

  it('stops a hung worker at the configured deadline', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    const spawnProcess = vi.fn(() => child);
    const result = transcribeAudio(new Uint8Array(200), {
      modelDirectory: 'C:\\models', spawnProcess: spawnProcess as never, timeoutMs: 50,
    });
    const refused = expect(result).rejects.toThrow('Zeitlimit');
    await vi.advanceTimersByTimeAsync(50);
    await refused;
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
