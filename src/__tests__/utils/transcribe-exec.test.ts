import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import '../mock-whisper.js';
import { mockWhisperState } from '../mock-whisper.js';

import { transcribe } from '../../tools/transcribe.js';
import { MOCK_AUDIO_PATH, MOCK_MODEL_PATH, MOCK_VIDEO_PATH, createTestContext } from '../fixtures.js';

const WORD_LINE_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$/;
const DURATION_REGEX = /^(\d{2}:\d{2}:\d{2}\.\d{3}) \((\d+\.\d+|\d+)s\)$/;
const EXPECTED_WORDS_COUNT = 2;
const MAX_CACHE_HIT_MS = 100;
const TEST_TIMEOUT_MS = 30_000;
const MIN_HEADER_LINES_COUNT = 3;
const MAX_MOCK_VIDEO_DURATION_SECONDS = 1.1;
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'transcribe-exec');

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

function parseTranscriptionOutput(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines.length).toBeGreaterThan(MIN_HEADER_LINES_COUNT);

  expect(lines[0]?.startsWith('Filename: ')).toBe(true);
  expect(lines[1]?.startsWith('File type: ')).toBe(true);
  expect(lines[2]?.startsWith('Duration: ')).toBe(true);

  const filename = lines[0]!.slice('Filename: '.length).trim();
  const fileType = lines[1]!.slice('File type: '.length).trim();
  const durationRaw = lines[2]!.slice('Duration: '.length).trim();
  const durationMatch = DURATION_REGEX.exec(durationRaw);
  expect(durationMatch).not.toBeNull();

  const words = lines.slice(MIN_HEADER_LINES_COUNT).map((line) => {
    const match = WORD_LINE_REGEX.exec(line);
    expect(match).not.toBeNull();
    return {
      start: match![1]!,
      end: match![2]!,
      word: match![3]!,
    };
  });

  return {
    metadata: {
      filename,
      fileType,
      durationTimestamp: durationMatch![1]!,
      durationSeconds: Number(durationMatch![2]!),
    },
    words,
  };
}

describe('transcribe execution output format', () => {
  test(
    'transcribe tool returns file metadata and timestamped spoken words',
    async () => {
      const output = (await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
          modelPath: MOCK_MODEL_PATH,
        },
        createTestContext(),
      )) as string;

      expect(typeof output).toBe('string');
      const { metadata, words: entries } = parseTranscriptionOutput(output);
      expect(metadata.filename).toBe(path.basename(MOCK_AUDIO_PATH));
      expect(metadata.fileType).toBe('audio/wav');
      expect(metadata.durationTimestamp).toBe('00:00:01.000');
      expect(metadata.durationSeconds).toBe(1);

      const reconstructedText = entries.map((entry) => entry.word.toLowerCase()).join(' ');
      expect(reconstructedText).toContain('fellow americans');
      expect(reconstructedText).toContain('what you can do for your country');

      const countryMatches = entries.filter((entry) => entry.word.toLowerCase() === 'country');
      expect(countryMatches).toHaveLength(EXPECTED_WORDS_COUNT);
      expect(countryMatches[1]!.start > countryMatches[0]!.start).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('transcribe video isolation', () => {
  test(
    'transcribe tool isolates audio from video files',
    async () => {
      const output = (await transcribe.execute(
        {
          filePath: MOCK_VIDEO_PATH,
          language: 'en',
          modelPath: MOCK_MODEL_PATH,
        },
        createTestContext(),
      )) as string;

      expect(typeof output).toBe('string');
      const { metadata, words: entries } = parseTranscriptionOutput(output);
      expect(metadata.filename).toBe(path.basename(MOCK_VIDEO_PATH));
      expect(metadata.fileType).toBe('video/mp4');
      expect(metadata.durationSeconds).toBeGreaterThanOrEqual(1);
      expect(metadata.durationSeconds).toBeLessThanOrEqual(MAX_MOCK_VIDEO_DURATION_SECONDS);

      const reconstructedText = entries.map((entry) => entry.word.toLowerCase()).join(' ');
      expect(reconstructedText).toContain('fellow americans');
      expect(reconstructedText).toContain('what you can do for your country');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('transcribe result caching', () => {
  test(
    'transcribe tool caches transcription results for unchanged files',
    async () => {
      const testContext = createTestContext();

      const firstResult = await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
          modelPath: MOCK_MODEL_PATH,
        },
        testContext,
      );

      const start = performance.now();
      const secondResult = await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
          modelPath: MOCK_MODEL_PATH,
        },
        testContext,
      );
      const elapsedMs = performance.now() - start;

      expect(secondResult).toBe(firstResult);
      expect(elapsedMs).toBeLessThan(MAX_CACHE_HIT_MS);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('transcribe media path error hints', () => {
  test('rejects missing audio or video file', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const missingMedia = path.join(TEST_ROOT, 'does-not-exist.mp3');
    await expect(
      transcribe.execute(
        {
          filePath: missingMedia,
          modelPath: MOCK_MODEL_PATH,
        },
        testContext,
      ),
    ).rejects.toThrow(/Audio\/video file not found:[\s\S]*Hint:/);
  });

  test('rejects missing, directory, or empty custom model files', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const missingModel = path.join(TEST_ROOT, 'missing-model.bin');
    await expect(transcribe.execute({ filePath: MOCK_AUDIO_PATH, modelPath: missingModel }, testContext)).rejects.toThrow(
      /Whisper model file not found at:[\s\S]*Hint:/,
    );

    await expect(transcribe.execute({ filePath: MOCK_AUDIO_PATH, modelPath: TEST_ROOT }, testContext)).rejects.toThrow(
      /Whisper model path is invalid \(is a directory\):[\s\S]*Hint:/,
    );

    const emptyModel = path.join(TEST_ROOT, 'empty-model.bin');
    fs.writeFileSync(emptyModel, '');
    await expect(transcribe.execute({ filePath: MOCK_AUDIO_PATH, modelPath: emptyModel }, testContext)).rejects.toThrow(
      /Whisper model path is invalid \(file is empty\):[\s\S]*Hint:/,
    );
  });
});

describe('transcribe model session error hints', () => {
  test('handles model initialization and execution failures with hints', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const failInitAudio = path.join(TEST_ROOT, 'fail-init.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, failInitAudio);
    mockWhisperState.failInit = true;
    try {
      await expect(transcribe.execute({ filePath: failInitAudio, modelPath: MOCK_MODEL_PATH }, testContext)).rejects.toThrow(
        /whisper\.cpp failed to initialize model[\s\S]*Hint:/,
      );
    } finally {
      mockWhisperState.failInit = false;
    }

    const failExecAudio = path.join(TEST_ROOT, 'fail-exec.wav');
    fs.copyFileSync(MOCK_AUDIO_PATH, failExecAudio);
    mockWhisperState.failFullDefault = true;
    try {
      await expect(transcribe.execute({ filePath: failExecAudio, modelPath: MOCK_MODEL_PATH }, testContext)).rejects.toThrow(
        /whisper\.cpp transcription failed with code 1[\s\S]*Hint:/,
      );
    } finally {
      mockWhisperState.failFullDefault = false;
    }
  });
});
