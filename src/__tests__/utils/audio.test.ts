import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import { mockFfmpegState } from '../mock-ffmpeg.js';

import { SAMPLE_RATE, convertAudioFile, decodeAudioToFloat32, getFileType, isVideoFile, resolveMediaFile } from '../../utils/audio.js';
import { FIXTURES_DIR, MOCK_AUDIO_PATH } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'audio');
const INCOMPLETE_PCM_BYTES_COUNT = 2;

beforeEach(() => {
  mockFfmpegState.reset();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

describe('media classification', () => {
  test('classifies audio and video files by extension', () => {
    expect(isVideoFile('clip.mp4')).toBe(true);
    expect(isVideoFile('MOVIE.MKV')).toBe(true);
    expect(isVideoFile('voice.wav')).toBe(false);

    expect(getFileType('sample.wav')).toBe('audio/wav');
    expect(getFileType('clip.MP4')).toBe('video/mp4');
    expect(getFileType('noext')).toBe('audio');
  });
});

describe('resolveMediaFile', () => {
  test('resolves existing media and rejects invalid paths', async () => {
    const { resolvedPath, stat } = await resolveMediaFile(path.basename(MOCK_AUDIO_PATH), FIXTURES_DIR, 'filePath');
    expect(resolvedPath).toBe(path.resolve(FIXTURES_DIR, path.basename(MOCK_AUDIO_PATH)));
    expect(stat.size).toBeGreaterThan(0);

    await expect(resolveMediaFile('  ', FIXTURES_DIR, 'filePath')).rejects.toThrow(/Missing required 'filePath'/);
    await expect(resolveMediaFile(path.join(FIXTURES_DIR, 'missing.wav'), FIXTURES_DIR, 'inputPath')).rejects.toThrow(/not found/);
    await expect(resolveMediaFile(FIXTURES_DIR, FIXTURES_DIR, 'filePath')).rejects.toThrow(/directory/);

    const emptyMedia = path.join(TEST_ROOT, 'empty.wav');
    fs.writeFileSync(emptyMedia, '');
    await expect(resolveMediaFile(emptyMedia, TEST_ROOT, 'filePath')).rejects.toThrow(/empty \(0 bytes\)/);
  });
});

describe('decodeAudioToFloat32', () => {
  test('decodes media files and pcmf32 files into float samples', async () => {
    const samples = await decodeAudioToFloat32(MOCK_AUDIO_PATH);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Math.round(samples.length / SAMPLE_RATE)).toBe(1);

    const pcmData = new Float32Array(SAMPLE_RATE);
    const pcmFile = path.join(TEST_ROOT, 'valid.pcmf32');
    fs.writeFileSync(pcmFile, Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength));
    expect(await decodeAudioToFloat32(pcmFile)).toHaveLength(SAMPLE_RATE);
  });

  test('rejects empty pcmf32 files and videos without an audio stream', async () => {
    const emptyPcm = path.join(TEST_ROOT, 'empty.pcmf32');
    fs.writeFileSync(emptyPcm, Buffer.alloc(INCOMPLETE_PCM_BYTES_COUNT));
    await expect(decodeAudioToFloat32(emptyPcm)).rejects.toThrow(/0 samples/);

    const silentVideo = path.join(TEST_ROOT, 'silent.mp4');
    fs.writeFileSync(silentVideo, 'mock-silent-video');
    mockFfmpegState.filePathModes.set(silentVideo, 'no-stream');
    await expect(decodeAudioToFloat32(silentVideo)).rejects.toThrow(/no audio stream found/);
  });
});

describe('convertAudioFile', () => {
  test('converts media and returns the output path', async () => {
    const outputPath = path.join(TEST_ROOT, 'converted.pcmf32');
    await expect(convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath, format: 'pcmf32', overwrite: true })).resolves.toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  test('guards against overwriting outputs, input collisions, and paths outside the working directory', async () => {
    const existingOutput = path.join(TEST_ROOT, 'existing.wav');
    fs.writeFileSync(existingOutput, '');
    await expect(convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: existingOutput, format: 'wav', overwrite: false })).rejects.toThrow(
      /already exists/,
    );
    await expect(convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: MOCK_AUDIO_PATH, format: 'wav' })).rejects.toThrow(/same as input/);
    await expect(
      convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: '../outside.wav', format: 'wav', directory: TEST_ROOT }),
    ).rejects.toThrow(/outside the working directory/);
  });

  test('derives a non-colliding output name when the target matches the input', async () => {
    const inputCopy = path.join(TEST_ROOT, 'source.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, inputCopy);

    await expect(convertAudioFile({ inputPath: inputCopy, format: 'wav', overwrite: true })).resolves.toBe(
      path.join(TEST_ROOT, 'source.converted.wav'),
    );
  });

  test('creates missing output directories and removes the conversion marker', async () => {
    const nestedOutput = path.join(TEST_ROOT, 'nested', 'deeper', 'converted.pcmf32');
    await expect(convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: nestedOutput, format: 'pcmf32', overwrite: true })).resolves.toBe(
      nestedOutput,
    );

    expect(fs.existsSync(nestedOutput)).toBe(true);
    expect(fs.existsSync(path.join(TEST_ROOT, 'nested', 'deeper', '.w2oc-convert-marker'))).toBe(false);
  });

  test('surfaces ffmpeg conversion failures', async () => {
    mockFfmpegState.convertMode = 'no-stream';
    await expect(convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: path.join(TEST_ROOT, 'fail.wav'), format: 'wav' })).rejects.toThrow(
      /no audio stream found/,
    );
  });
});
