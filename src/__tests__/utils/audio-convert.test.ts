import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import { mockFfmpegState } from '../mock-ffmpeg.js';

import { convert_audio } from '../../tools/convert-audio.js';
import { SAMPLE_RATE, convertAudioFile, decodeAudioToFloat32 } from '../../utils/audio.js';
import { MOCK_AUDIO_PATH, createTestContext } from '../fixtures.js';

const EXPECTED_AUDIO_SAMPLE_RATE = 16_000;
const MONO_CHANNEL_COUNT = 1;
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'audio-convert');

describe('convert_audio tool execution and validation', () => {
  beforeEach(() => {
    mockFfmpegState.reset();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('converts audio to pcmf32 format with overwrite guard enabled', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const outputPcmPath = path.join(TEST_ROOT, 'converted.pcmf32');

    const resultPath = await convert_audio.execute(
      {
        inputPath: MOCK_AUDIO_PATH,
        outputPath: outputPcmPath,
        format: 'pcmf32',
        sampleRate: EXPECTED_AUDIO_SAMPLE_RATE,
        channels: MONO_CHANNEL_COUNT,
        overwrite: true,
      },
      testContext,
    );

    expect(resultPath).toBe(outputPcmPath);
    expect(fs.existsSync(outputPcmPath)).toBe(true);
    const decoded = decodeAudioToFloat32(outputPcmPath);
    expect(Math.round(decoded.length / SAMPLE_RATE)).toBe(1);
  });

  test('rejects missing source file with actionable hint', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const missingSource = path.join(TEST_ROOT, 'nonexistent-source.mp4');
    await expect(
      convert_audio.execute(
        {
          inputPath: missingSource,
          format: 'wav',
        },
        testContext,
      ),
    ).rejects.toThrow(/Source media file not found:[\s\S]*Hint:/);
  });
});

describe('convertAudioFile collision and output generation', () => {
  beforeEach(() => {
    mockFfmpegState.reset();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('enforces output overwrite and path collision guards', () => {
    const outputPcmPath = path.join(TEST_ROOT, 'existing.pcmf32');
    fs.writeFileSync(outputPcmPath, Buffer.alloc(0));

    expect(() =>
      convertAudioFile({
        inputPath: MOCK_AUDIO_PATH,
        outputPath: outputPcmPath,
        format: 'pcmf32',
        overwrite: false,
      }),
    ).toThrow(/Output file already exists:[\s\S]*Hint:/);

    expect(() =>
      convertAudioFile({
        inputPath: MOCK_AUDIO_PATH,
        outputPath: MOCK_AUDIO_PATH,
        format: 'wav',
      }),
    ).toThrow(/cannot be the same as input path[\s\S]*Hint:/);
  });

  test('generates automatic converted path when candidate equals input path', () => {
    const inputCopy = path.join(TEST_ROOT, 'source.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, inputCopy);
    const autoConvertedPath = convertAudioFile({
      inputPath: inputCopy,
      format: 'wav',
      overwrite: true,
    });
    const expectedConvertedPath = path.join(TEST_ROOT, 'source.converted.wav');
    expect(autoConvertedPath).toBe(expectedConvertedPath);
    expect(fs.existsSync(expectedConvertedPath)).toBe(true);
  });
});

describe('convertAudioFile ffmpeg failure handling', () => {
  beforeEach(() => {
    mockFfmpegState.reset();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('rejects when conversion encounters no audio stream', () => {
    mockFfmpegState.convertMode = 'no-stream';
    expect(() =>
      convertAudioFile({
        inputPath: MOCK_AUDIO_PATH,
        outputPath: path.join(TEST_ROOT, 'fail-nostream.wav'),
        format: 'wav',
        overwrite: true,
      }),
    ).toThrow(/Failed to convert[\s\S]*no audio stream found[\s\S]*Hint:/);
  });

  test('rejects when conversion encounters generic ffmpeg failure', () => {
    mockFfmpegState.convertMode = 'generic';
    expect(() =>
      convertAudioFile({
        inputPath: MOCK_AUDIO_PATH,
        outputPath: path.join(TEST_ROOT, 'fail-generic.wav'),
        format: 'wav',
        overwrite: true,
      }),
    ).toThrow(/Failed to convert[\s\S]*ffmpeg generic convert failure[\s\S]*Hint:/);
  });
});
