import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES_DIR = path.join(__dirname, 'fixtures');
export const MOCK_AUDIO_PATH = path.join(FIXTURES_DIR, 'mock-audio.wav');
export const MOCK_VIDEO_PATH = path.join(FIXTURES_DIR, 'mock-video.mp4');
export const MOCK_MODEL_PATH = path.join(FIXTURES_DIR, 'mock-model.bin');

export function createMockWavBuffer(durationSeconds = 1, sampleRate = 16000): Buffer {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // 1 = PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), 44 + i * 2);
  }

  return buffer;
}

export function ensureFixturesExist(): void {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  if (!fs.existsSync(MOCK_AUDIO_PATH)) {
    fs.writeFileSync(MOCK_AUDIO_PATH, createMockWavBuffer(1, 16000));
  }

  if (!fs.existsSync(MOCK_VIDEO_PATH)) {
    fs.writeFileSync(MOCK_VIDEO_PATH, Buffer.from('mock-video-mp4-whisper2opencode'));
  }

  if (!fs.existsSync(MOCK_MODEL_PATH)) {
    fs.writeFileSync(MOCK_MODEL_PATH, Buffer.from('ggml-mock-model-whisper2opencode'));
  }
}

ensureFixturesExist();

export function createTestContext(dir?: string) {
  const directory = dir ?? FIXTURES_DIR;
  return {
    sessionID: 'test-session',
    messageID: 'test-msg',
    agent: 'build',
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } as any;
}
