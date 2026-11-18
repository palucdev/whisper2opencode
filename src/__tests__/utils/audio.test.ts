import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import { mockFfmpegState } from '../mock-ffmpeg.js';

import { SAMPLE_RATE, convertAudioFile, decodeAudioToFloat32, getFileType, isVideoFile, resolveMediaFile } from '../../utils/audio.js';
import { FIXTURES_DIR, MOCK_AUDIO_PATH } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'audio');
const INCOMPLETE_PCM_BYTES_COUNT = 2;

const scratchPath = (fileName: string): string => path.join(TEST_ROOT, fileName);

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
  test('resolves existing media and rejects invalid paths', () => {
    const { resolvedPath, stat } = resolveMediaFile(path.basename(MOCK_AUDIO_PATH), FIXTURES_DIR, 'filePath');
    expect(resolvedPath).toBe(path.resolve(FIXTURES_DIR, path.basename(MOCK_AUDIO_PATH)));
    expect(stat.size).toBeGreaterThan(0);

    expect(() => resolveMediaFile('  ', FIXTURES_DIR, 'filePath')).toThrow(/Missing required 'filePath'/);
    expect(() => resolveMediaFile(path.join(FIXTURES_DIR, 'missing.wav'), FIXTURES_DIR, 'inputPath')).toThrow(/not found/);
    expect(() => resolveMediaFile(FIXTURES_DIR, FIXTURES_DIR, 'filePath')).toThrow(/directory/);

    const emptyMedia = scratchPath('empty.wav');
    fs.writeFileSync(emptyMedia, '');
    expect(() => resolveMediaFile(emptyMedia, TEST_ROOT, 'filePath')).toThrow(/empty \(0 bytes\)/);
  });
});

describe('decodeAudioToFloat32', () => {
  test('decodes media files and pcmf32 files into float samples', () => {
    const samples = decodeAudioToFloat32(MOCK_AUDIO_PATH);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Math.round(samples.length / SAMPLE_RATE)).toBe(1);

    const pcmData = new Float32Array(SAMPLE_RATE);
    const pcmFile = scratchPath('valid.pcmf32');
    fs.writeFileSync(pcmFile, Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength));
    expect(decodeAudioToFloat32(pcmFile)).toHaveLength(SAMPLE_RATE);
  });

  test('rejects empty pcmf32 files and videos without an audio stream', () => {
    const emptyPcm = scratchPath('empty.pcmf32');
    fs.writeFileSync(emptyPcm, Buffer.alloc(INCOMPLETE_PCM_BYTES_COUNT));
    expect(() => decodeAudioToFloat32(emptyPcm)).toThrow(/0 samples/);

    const silentVideo = scratchPath('silent.mp4');
    fs.writeFileSync(silentVideo, 'mock-silent-video');
    mockFfmpegState.filePathModes.set(silentVideo, 'no-stream');
    expect(() => decodeAudioToFloat32(silentVideo)).toThrow(/no audio stream found/);
  });
});

describe('convertAudioFile', () => {
  test('converts media and returns the output path', () => {
    const outputPath = scratchPath('converted.pcmf32');
    expect(convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath, format: 'pcmf32', overwrite: true })).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  test('guards against overwriting outputs and input collisions', () => {
    const existingOutput = scratchPath('existing.wav');
    fs.writeFileSync(existingOutput, '');
    expect(() => convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: existingOutput, format: 'wav', overwrite: false })).toThrow(
      /already exists/,
    );
    expect(() => convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: MOCK_AUDIO_PATH, format: 'wav' })).toThrow(/same as input/);
  });

  test('derives a non-colliding output name when the target matches the input', () => {
    const inputCopy = scratchPath('source.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, inputCopy);

    expect(convertAudioFile({ inputPath: inputCopy, format: 'wav', overwrite: true })).toBe(scratchPath('source.converted.wav'));
  });

  test('surfaces ffmpeg conversion failures', () => {
    mockFfmpegState.convertMode = 'no-stream';
    expect(() => convertAudioFile({ inputPath: MOCK_AUDIO_PATH, outputPath: scratchPath('fail.wav'), format: 'wav' })).toThrow(
      /no audio stream found/,
    );
  });
});
