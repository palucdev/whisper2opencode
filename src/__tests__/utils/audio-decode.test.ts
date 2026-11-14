import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import { mockFfmpegState } from '../mock-ffmpeg.js';

import { SAMPLE_RATE, decodeAudioToFloat32, getFileType, getFfmpegBinary, isVideoFile, resolveMediaFile } from '../../utils/audio.js';
import { formatFfmpegStderr } from '../../utils/ffmpeg-runner.js';
import { FIXTURES_DIR, MOCK_AUDIO_PATH } from '../fixtures.js';

const EXPECTED_DEFAULT_SAMPLE_RATE = 16_000;
const PADDED_SPACES_COUNT = 3;
const INCOMPLETE_PCM_BYTES_COUNT = 2;
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'audio-decode');
const EMPTY_MEDIA_PATH = path.join(TEST_ROOT, 'empty.wav');
const VALID_PCM_PATH = path.join(TEST_ROOT, 'valid.pcmf32');
const INVALID_AUDIO_PATH = path.join(TEST_ROOT, 'invalid.mp3');
const GENERIC_ERROR_PATH = path.join(TEST_ROOT, 'generic-error.mp3');
const TINY_PCM_PATH = path.join(TEST_ROOT, 'tiny.pcmf32');
const SILENT_VIDEO_PATH = path.join(TEST_ROOT, 'silent.mp4');
const ZERO_SAMPLES_PATH = path.join(TEST_ROOT, 'zero-samples.mp3');

beforeEach(() => {
  mockFfmpegState.reset();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

describe('audio classification and binary resolution', () => {
  test('isVideoFile and getFileType classify audio and video paths', () => {
    expect(SAMPLE_RATE).toBe(EXPECTED_DEFAULT_SAMPLE_RATE);
    expect(isVideoFile('clip.mp4')).toBe(true);
    expect(isVideoFile('MOVIE.MKV')).toBe(true);
    expect(isVideoFile('voice.wav')).toBe(false);
    expect(isVideoFile('song.mp3')).toBe(false);

    expect(getFileType('sample.wav')).toBe('audio/wav');
    expect(getFileType(path.join('media', 'clip.MP4'))).toBe('video/mp4');
    expect(getFileType('noext')).toBe('audio');
  });

  test('getFfmpegBinary resolves mocked executable path and handles overrides', () => {
    const binary = getFfmpegBinary();
    expect(typeof binary).toBe('string');
    expect(binary).toBe('/mock/bin/ffmpeg');

    expect(getFfmpegBinary({ default: '/custom/bin/ffmpeg' })).toBe('/custom/bin/ffmpeg');
    expect(() => getFfmpegBinary({ default: ' '.repeat(PADDED_SPACES_COUNT) })).toThrow(
      /'ffmpeg' is required to extract and decode audio from media files[\s\S]*Hint:/,
    );
    expect(() => getFfmpegBinary('')).toThrow(/'ffmpeg' is required to extract and decode audio from media files[\s\S]*Hint:/);
    expect(() =>
      getFfmpegBinary(undefined, () => {
        throw new Error('module not found');
      }),
    ).toThrow(/'ffmpeg' is required to extract and decode audio from media files[\s\S]*Hint:/);

    const environmentSource = Reflect.get(process, 'env') as Record<string, string | undefined>;
    const originalEnvironment = environmentSource.FFMPEG_PATH;
    try {
      Reflect.set(environmentSource, 'FFMPEG_PATH', '/env/bin/ffmpeg');
      expect(getFfmpegBinary()).toBe('/env/bin/ffmpeg');
    } finally {
      if (originalEnvironment === undefined) {
        Reflect.deleteProperty(environmentSource, 'FFMPEG_PATH');
      } else {
        Reflect.set(environmentSource, 'FFMPEG_PATH', originalEnvironment);
      }
    }
  });

  test('formatFfmpegStderr handles Error instances and string messages', () => {
    const fromError = formatFfmpegStderr(new Error('custom error message'));
    expect(fromError.raw).toBe('custom error message');
    expect(fromError.detail).toBe('custom error message');

    const fromString = formatFfmpegStderr('simple error string');
    expect(fromString.raw).toBe('simple error string');
    expect(fromString.detail).toBe('simple error string');
  });
});

describe('resolveMediaFile validation', () => {
  test('validates existing media paths and provides recovery hints', () => {
    const mockAudioFilename = path.basename(MOCK_AUDIO_PATH);
    const { resolvedPath, stat } = resolveMediaFile(mockAudioFilename, FIXTURES_DIR, 'filePath');
    expect(resolvedPath).toBe(path.resolve(FIXTURES_DIR, mockAudioFilename));
    expect(stat.size).toBeGreaterThan(0);

    expect(() => resolveMediaFile(' '.repeat(PADDED_SPACES_COUNT), FIXTURES_DIR, 'filePath')).toThrow(
      /Missing required 'filePath' argument[\s\S]*Hint:/,
    );

    const missingPath = path.join(FIXTURES_DIR, 'missing.wav');
    expect(() => resolveMediaFile(missingPath, FIXTURES_DIR, 'inputPath')).toThrow(/Source media file not found:[\s\S]*Hint:/);

    expect(() => resolveMediaFile(FIXTURES_DIR, FIXTURES_DIR, 'filePath')).toThrow(/Path is a directory[\s\S]*Hint:/);
  });

  test('rejects empty zero-byte media file', () => {
    fs.writeFileSync(EMPTY_MEDIA_PATH, '');
    expect(() => resolveMediaFile(EMPTY_MEDIA_PATH, FIXTURES_DIR, 'filePath')).toThrow(/Audio\/video file is empty \(0 bytes\)[\s\S]*Hint:/);
  });
});

describe('decodeAudioToFloat32 valid inputs', () => {
  test('decodes mock audio and valid pcmf32 file', () => {
    const samples = decodeAudioToFloat32(MOCK_AUDIO_PATH);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Math.round(samples.length / SAMPLE_RATE)).toBe(1);

    const pcmData = new Float32Array(SAMPLE_RATE);
    fs.writeFileSync(VALID_PCM_PATH, Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength));
    const pcmSamples = decodeAudioToFloat32(VALID_PCM_PATH);
    expect(pcmSamples).toBeInstanceOf(Float32Array);
    expect(pcmSamples).toHaveLength(SAMPLE_RATE);
  });
});

describe('decodeAudioToFloat32 media format error handling', () => {
  test('rejects corrupted or invalid media format', () => {
    fs.writeFileSync(INVALID_AUDIO_PATH, '<html><body>404 Not Found</body></html>');
    mockFfmpegState.filePathModes.set(INVALID_AUDIO_PATH, 'invalid-format');
    expect(() => decodeAudioToFloat32(INVALID_AUDIO_PATH)).toThrow(/Failed to decode audio[\s\S]*invalid or corrupted media format[\s\S]*Hint:/);
  });

  test('rejects generic ffmpeg decode errors', () => {
    fs.writeFileSync(GENERIC_ERROR_PATH, 'generic-error-content');
    mockFfmpegState.filePathModes.set(GENERIC_ERROR_PATH, 'generic');
    expect(() => decodeAudioToFloat32(GENERIC_ERROR_PATH)).toThrow(/Failed to decode audio[\s\S]*ffmpeg generic decode error[\s\S]*Hint:/);
  });
});

describe('decodeAudioToFloat32 stream and buffer errors', () => {
  test('rejects empty pcmf32 file and silent video stream', () => {
    fs.writeFileSync(TINY_PCM_PATH, Buffer.alloc(INCOMPLETE_PCM_BYTES_COUNT));
    expect(() => decodeAudioToFloat32(TINY_PCM_PATH)).toThrow(/contains 0 samples[\s\S]*Hint:/);

    fs.writeFileSync(SILENT_VIDEO_PATH, 'mock-silent-video');
    mockFfmpegState.filePathModes.set(SILENT_VIDEO_PATH, 'no-stream');
    expect(() => decodeAudioToFloat32(SILENT_VIDEO_PATH)).toThrow(/Failed to isolate audio from video[\s\S]*no audio stream found[\s\S]*Hint:/);
  });

  test('rejects empty decoded audio stream from ffmpeg', () => {
    fs.writeFileSync(ZERO_SAMPLES_PATH, 'mock-empty-audio');
    mockFfmpegState.filePathModes.set(ZERO_SAMPLES_PATH, 'zero-samples');
    expect(() => decodeAudioToFloat32(ZERO_SAMPLES_PATH)).toThrow(/contains 0 samples[\s\S]*Hint:/);
  });
});
