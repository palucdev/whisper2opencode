import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import '../mock-whisper.js';
import { mockWhisperState } from '../mock-whisper.js';

import type { WhisperFactory } from '../../types/whisper-types.js';
import { loadWhisperFactory, transcribeAudioFile } from '../../utils/transcribe.js';
import { MOCK_AUDIO_PATH, MOCK_MODEL_PATH, MOCK_VIDEO_PATH } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'transcribe');
const LOCAL_PACKAGE_ROOT = path.join(TEST_ROOT, 'local-package');

const customFactory: WhisperFactory = () =>
  Promise.resolve({
    FS_createDataFile: () => {},
    init: () => true,
    full_default: () => 0,
    free: () => {},
  });

beforeEach(() => {
  mockWhisperState.reset();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

describe('loadWhisperFactory', () => {
  test('resolves overrides and the globally available factory', () => {
    expect(loadWhisperFactory(customFactory)).toBe(customFactory);
    expect(typeof loadWhisperFactory()).toBe('function');
  });

  test('resolves a factory from the target directory', () => {
    const packageDirectory = path.join(LOCAL_PACKAGE_ROOT, 'node_modules', 'whisper.cpp');
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: 'whisper.cpp', main: 'index.js' }));
    fs.writeFileSync(path.join(packageDirectory, 'index.js'), 'module.exports = function() { return Promise.resolve({ init: () => true }); };');

    const factory = loadWhisperFactory(
      undefined,
      () => {
        throw new Error('not globally installed');
      },
      LOCAL_PACKAGE_ROOT,
    );
    expect(typeof factory).toBe('function');
  });

  test('throws an actionable error when whisper.cpp cannot be loaded', () => {
    expect(() => loadWhisperFactory('not-a-factory')).toThrow(/Package 'whisper\.cpp' is required/);
    expect(() =>
      loadWhisperFactory(undefined, () => {
        throw new Error('missing');
      }),
    ).toThrow(/Package 'whisper\.cpp' is required/);
  });
});

describe('transcribeAudioFile', () => {
  test('returns metadata and timestamped words for audio files', async () => {
    const output = await transcribeAudioFile({ filePath: MOCK_AUDIO_PATH, language: 'en', modelPath: MOCK_MODEL_PATH });

    expect(output).toContain('Filename: mock-audio.wav');
    expect(output).toContain('File type: audio/wav');
    expect(output).toContain('Duration: 00:00:01.000 (1.00s)');
    expect(output).toContain('fellow');
    expect(output).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\] \S+$/m);
  });

  test('isolates audio from video files', async () => {
    const output = await transcribeAudioFile({ filePath: MOCK_VIDEO_PATH, language: 'en', modelPath: MOCK_MODEL_PATH });

    expect(output).toContain('File type: video/mp4');
    expect(output).toContain('fellow');
  });

  test('caches results for unchanged files', async () => {
    const firstResult = await transcribeAudioFile({ filePath: MOCK_AUDIO_PATH, language: 'en', modelPath: MOCK_MODEL_PATH });
    const secondResult = await transcribeAudioFile({ filePath: MOCK_AUDIO_PATH, language: 'en', modelPath: MOCK_MODEL_PATH });

    expect(secondResult).toBe(firstResult);
  });

  test('reports model initialization and execution failures', async () => {
    const failInitAudio = path.join(TEST_ROOT, 'fail-init.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, failInitAudio);
    mockWhisperState.failInit = true;
    try {
      await expect(transcribeAudioFile({ filePath: failInitAudio, modelPath: MOCK_MODEL_PATH })).rejects.toThrow(/failed to initialize model/);
    } finally {
      mockWhisperState.failInit = false;
    }

    const failExecutionAudio = path.join(TEST_ROOT, 'fail-execution.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, failExecutionAudio);
    mockWhisperState.failFullDefault = true;
    try {
      await expect(transcribeAudioFile({ filePath: failExecutionAudio, modelPath: MOCK_MODEL_PATH })).rejects.toThrow(
        /transcription failed with code 1/,
      );
    } finally {
      mockWhisperState.failFullDefault = false;
    }
  });
});
