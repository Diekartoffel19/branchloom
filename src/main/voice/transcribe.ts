import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 120_000;

// The clip stays in memory. Python decodes the browser's WebM/Opus or WAV
// bytes through PyAV and is explicitly forbidden from downloading a model.
const PYTHON_TRANSCRIBER = String.raw`
import io
import json
import sys
from pathlib import Path

try:
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    model_root = Path(sys.argv[1])
    if not model_root.is_dir():
        raise RuntimeError("Whisper-Modell fehlt. Bitte die lokale Spracheinrichtung ausführen.")
    audio = sys.stdin.buffer.read()
    samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
    seconds = len(samples) / 16000
    if seconds < 0.2 or seconds > 60:
        raise ValueError("Die Aufnahme muss zwischen 0,2 und 60 Sekunden dauern.")
    model = WhisperModel("base", device="cpu", compute_type="int8", download_root=str(model_root), local_files_only=True)
    segments, _ = model.transcribe(samples, language="de", beam_size=3, vad_filter=True, condition_on_previous_text=False)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise ValueError("Keine verständliche Sprache erkannt.")
    print(json.dumps({"text": text}, ensure_ascii=False), flush=True)
except ModuleNotFoundError as exc:
    print(json.dumps({"error": "Python-Paket faster-whisper fehlt: " + str(exc)}, ensure_ascii=False), flush=True)
except Exception as exc:
    print(json.dumps({"error": str(exc)[:300]}, ensure_ascii=False), flush=True)
`;

export interface VoiceRuntimeOptions {
  python?: string;
  modelDirectory?: string;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}

function defaultModelDirectory(): string {
  const appData = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : join(homedir(), '.local', 'share');
  return join(appData, 'JarvisStudio', 'voice-models');
}

/** Find the optional setup beside source or inside a portable Forge bundle. */
export function defaultVoicePython(): string {
  const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  const candidates = [
    join(process.cwd(), '.venv', executable),
    ...(process.resourcesPath ? [join(process.resourcesPath, 'app', '.venv', executable)] : []),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'python';
}

/** Offline German speech-to-text. No recording or transcript file is written. */
export async function transcribeAudio(audio: Uint8Array, options: VoiceRuntimeOptions = {}): Promise<string> {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 100 || audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('Die Aufnahme muss zwischen 100 Byte und 8 MiB groß sein.');
  }
  const modelDirectory = options.modelDirectory ?? process.env.JARVIS_STUDIO_WHISPER_MODEL_DIR ?? defaultModelDirectory();
  if (!isAbsolute(modelDirectory)) throw new Error('JARVIS_STUDIO_WHISPER_MODEL_DIR muss ein absoluter Pfad sein.');
  const python = options.python ?? process.env.JARVIS_STUDIO_PYTHON ?? defaultVoicePython();
  const spawnProcess = options.spawnProcess ?? spawn;
  const timeoutMs = options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(python, ['-c', PYTHON_TRANSCRIBER, modelDirectory], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch {
      reject(new Error('Lokale Spracherkennung konnte Python nicht starten. Siehe docs/VOICE.md.'));
      return;
    }

    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (result: string | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Die lokale Transkription hat das Zeitlimit von zwei Minuten erreicht.'));
    }, timeoutMs);

    child.on('error', () => finish(new Error('Lokale Spracherkennung konnte Python nicht starten. Siehe docs/VOICE.md.')));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('Die Spracherkennung lieferte eine zu große Antwort.'));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2_000); });
    child.on('close', (code) => {
      if (settled) return;
      let parsed: { text?: unknown; error?: unknown };
      try { parsed = JSON.parse(stdout.trim()) as { text?: unknown; error?: unknown }; }
      catch {
        finish(new Error(`Die lokale Spracherkennung ist fehlgeschlagen${code === null ? '' : ` (Code ${code})`}. ${stderr.slice(-300)}`.trim()));
        return;
      }
      if (typeof parsed.text === 'string' && parsed.text.trim()) finish(parsed.text.trim());
      else if (typeof parsed.error === 'string') finish(new Error(parsed.error));
      else finish(new Error('Die Spracherkennung hat keinen Text geliefert.'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(audio));
  });
}
