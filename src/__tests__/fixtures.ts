import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES_DIR = path.join(__dirname, 'fixtures');
export const MOCK_AUDIO_PATH = path.join(FIXTURES_DIR, 'mock-audio.wav');
export const MOCK_VIDEO_PATH = path.join(FIXTURES_DIR, 'mock-video.mp4');
export const MOCK_MODEL_PATH = path.join(FIXTURES_DIR, 'mock-model.bin');

export const DEFAULT_MOCK_SAMPLE_RATE = 16_000;
const BYTES_PER_16BIT_SAMPLE = 2;
const WAV_HEADER_TOTAL_SIZE = 44;
const RIFF_HEADER_EXTRA_OFFSET = 36;
const RIFF_CHUNK_SIZE_OFFSET = 4;
const WAVE_FORMAT_OFFSET = 8;
const FMT_CHUNK_OFFSET = 12;
const FMT_CHUNK_SIZE = 16;
const FMT_CHUNK_SIZE_OFFSET = 16;
const AUDIO_FORMAT_PCM = 1;
const AUDIO_FORMAT_OFFSET = 20;
const MONO_CHANNELS = 1;
const CHANNELS_OFFSET = 22;
const SAMPLE_RATE_OFFSET = 24;
const BYTE_RATE_OFFSET = 28;
const BLOCK_ALIGN_OFFSET = 32;
const BITS_PER_SAMPLE_16 = 16;
const BITS_PER_SAMPLE_OFFSET = 34;
const DATA_CHUNK_HEADER_OFFSET = 36;
const DATA_CHUNK_SIZE_OFFSET = 40;
const SINE_WAVE_FREQUENCY_HZ = 440;
const SINE_WAVE_AMPLITUDE = 16_000;
const PCM16_MIN_VALUE = -32_768;
const PCM16_MAX_VALUE = 32_767;
const TWO_PI_MULTIPLIER = 2;

const clampPcm16 = (sampleValue: number): number => {
  const roundedValue = Math.round(sampleValue);
  const cappedValue = Math.min(PCM16_MAX_VALUE, roundedValue);
  return Math.max(PCM16_MIN_VALUE, cappedValue);
};

interface WavHeaderOptions {
  dataSize: number;
  sampleRate: number;
}

const writeWavHeader = (buffer: Buffer, options: WavHeaderOptions): void => {
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(RIFF_HEADER_EXTRA_OFFSET + options.dataSize, RIFF_CHUNK_SIZE_OFFSET);
  buffer.write('WAVE', WAVE_FORMAT_OFFSET);
  buffer.write('fmt ', FMT_CHUNK_OFFSET);
  buffer.writeUInt32LE(FMT_CHUNK_SIZE, FMT_CHUNK_SIZE_OFFSET);
  buffer.writeUInt16LE(AUDIO_FORMAT_PCM, AUDIO_FORMAT_OFFSET);
  buffer.writeUInt16LE(MONO_CHANNELS, CHANNELS_OFFSET);
  buffer.writeUInt32LE(options.sampleRate, SAMPLE_RATE_OFFSET);
  buffer.writeUInt32LE(options.sampleRate * BYTES_PER_16BIT_SAMPLE, BYTE_RATE_OFFSET);
  buffer.writeUInt16LE(BYTES_PER_16BIT_SAMPLE, BLOCK_ALIGN_OFFSET);
  buffer.writeUInt16LE(BITS_PER_SAMPLE_16, BITS_PER_SAMPLE_OFFSET);
  buffer.write('data', DATA_CHUNK_HEADER_OFFSET);
  buffer.writeUInt32LE(options.dataSize, DATA_CHUNK_SIZE_OFFSET);
};

export function createMockWavBuffer(durationSeconds = 1, sampleRate = DEFAULT_MOCK_SAMPLE_RATE): Buffer {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * BYTES_PER_16BIT_SAMPLE;
  const buffer = Buffer.alloc(WAV_HEADER_TOTAL_SIZE + dataSize);

  writeWavHeader(buffer, { dataSize, sampleRate });

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const angle = (TWO_PI_MULTIPLIER * Math.PI * SINE_WAVE_FREQUENCY_HZ * sampleIndex) / sampleRate;
    const sample = Math.sin(angle) * SINE_WAVE_AMPLITUDE;
    buffer.writeInt16LE(clampPcm16(sample), WAV_HEADER_TOTAL_SIZE + sampleIndex * BYTES_PER_16BIT_SAMPLE);
  }

  return buffer;
}

export function ensureFixturesExist(): void {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  if (!fs.existsSync(MOCK_AUDIO_PATH)) {
    fs.writeFileSync(MOCK_AUDIO_PATH, createMockWavBuffer(1, DEFAULT_MOCK_SAMPLE_RATE));
  }

  if (!fs.existsSync(MOCK_VIDEO_PATH)) {
    fs.writeFileSync(MOCK_VIDEO_PATH, Buffer.from('mock-video-mp4-whisper2opencode'));
  }

  if (!fs.existsSync(MOCK_MODEL_PATH)) {
    fs.writeFileSync(MOCK_MODEL_PATH, Buffer.from('ggml-mock-model-whisper2opencode'));
  }
}

ensureFixturesExist();

export interface TestPluginContext {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(): void;
  ask(): Promise<void>;
}

export function createTestContext(initialDirectory?: string): TestPluginContext {
  const directory = initialDirectory ?? FIXTURES_DIR;
  return {
    sessionID: 'test-session',
    messageID: 'test-msg',
    agent: 'build',
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  };
}

const TAR_BLOCK_BYTES = 512;
const TAR_NAME_LIMIT = 100;
const TAR_MODE_OFFSET = 100;
const TAR_UID_OFFSET = 108;
const TAR_GID_OFFSET = 116;
const TAR_SIZE_OFFSET = 124;
const TAR_MTIME_OFFSET = 136;
const TAR_CHKSUM_OFFSET = 148;
const TAR_TYPE_OFFSET = 156;
const TAR_MAGIC_OFFSET = 257;
const TAR_VERSION_OFFSET = 263;
const TAR_FIELD_OCTAL_8 = 8;
const TAR_FIELD_OCTAL_12 = 12;
const TAR_MAGIC_LEN = 6;
const TAR_VERSION_LEN = 2;
const TAR_PAD_SIZE_6 = 6;
const TAR_PAD_SIZE_11 = 11;
const TAR_END_BLOCK_BYTES = 1024;
const OCTAL_BASE = 8;

function computeHeaderChecksum(tarHeader: Buffer): number {
  let checksum = 0;
  for (const byte of tarHeader) {
    checksum += byte;
  }
  return checksum;
}

function writeTarHeaderFields(tarHeader: Buffer, contentBuffer: Buffer): void {
  tarHeader.write('package/whisper.js', 0, TAR_NAME_LIMIT, 'utf8');
  tarHeader.write('0000644\0', TAR_MODE_OFFSET, TAR_FIELD_OCTAL_8, 'utf8');
  tarHeader.write('0000000\0', TAR_UID_OFFSET, TAR_FIELD_OCTAL_8, 'utf8');
  tarHeader.write('0000000\0', TAR_GID_OFFSET, TAR_FIELD_OCTAL_8, 'utf8');

  const sizeOctal = contentBuffer.length.toString(OCTAL_BASE).padStart(TAR_PAD_SIZE_11, '0') + '\0';
  tarHeader.write(sizeOctal, TAR_SIZE_OFFSET, TAR_FIELD_OCTAL_12, 'utf8');
  tarHeader.write('00000000000\0', TAR_MTIME_OFFSET, TAR_FIELD_OCTAL_12, 'utf8');
  tarHeader.write(' '.repeat(TAR_FIELD_OCTAL_8), TAR_CHKSUM_OFFSET, TAR_FIELD_OCTAL_8, 'utf8');
  tarHeader.write('0', TAR_TYPE_OFFSET, 1, 'utf8');
  tarHeader.write('ustar\0', TAR_MAGIC_OFFSET, TAR_MAGIC_LEN, 'utf8');
  tarHeader.write('00', TAR_VERSION_OFFSET, TAR_VERSION_LEN, 'utf8');

  const checksum = computeHeaderChecksum(tarHeader);
  const checksumOctal = checksum.toString(OCTAL_BASE).padStart(TAR_PAD_SIZE_6, '0') + '\0 ';
  tarHeader.write(checksumOctal, TAR_CHKSUM_OFFSET, TAR_FIELD_OCTAL_8, 'utf8');
}

export function createMinimalTarGz(content: string): Buffer {
  const tarHeader = Buffer.alloc(TAR_BLOCK_BYTES);
  const contentBuffer = Buffer.from(content, 'utf8');
  writeTarHeaderFields(tarHeader, contentBuffer);

  const padSize = Math.ceil(contentBuffer.length / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES - contentBuffer.length;
  const padding = Buffer.alloc(padSize);
  const endBlocks = Buffer.alloc(TAR_END_BLOCK_BYTES);

  const tarData = Buffer.concat([tarHeader, contentBuffer, padding, endBlocks]);
  return zlib.gzipSync(tarData);
}
