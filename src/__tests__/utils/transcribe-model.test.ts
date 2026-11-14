import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import '../mock-ffmpeg.js';
import '../mock-whisper.js';

import { transcribe } from '../../tools/transcribe.js';
import type { WhisperFactory } from '../../types/whisper-types.js';
import { loadWhisperFactory } from '../../utils/transcribe.js';
import { MOCK_AUDIO_PATH, createTestContext } from '../fixtures.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'transcribe-model');
const TEST_HOME_ROOT = path.join(TEST_ROOT, 'home');
const LOCAL_PACKAGE_ROOT = path.join(TEST_ROOT, 'local-package');

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

const mockCustomFactory: WhisperFactory = () =>
  Promise.resolve({
    FS_createDataFile: () => {},
    init: () => true,
    full_default: () => 0,
    free: () => {},
  });

const mockThrowingLoader = (): never => {
  throw new Error('cannot find module');
};

const mockNonFunctionLoader = () => ({ notAFunction: true });

describe('loadWhisperFactory factory resolution and overrides', () => {
  test('loads mocked factory successfully', () => {
    const factory = loadWhisperFactory();
    expect(typeof factory).toBe('function');
  });

  test('accepts valid factory function override', () => {
    expect(loadWhisperFactory(mockCustomFactory)).toBe(mockCustomFactory);
  });

  test('throws descriptive error when override is invalid', () => {
    expect(() => loadWhisperFactory('not-a-valid-factory')).toThrow(
      /Package 'whisper\.cpp' is required for transcription[\s\S]*download_whisper_cpp[\s\S]*bun add whisper\.cpp[\s\S]*npm install whisper\.cpp[\s\S]*ggml-base\.en\.bin[\s\S]*ggml-base\.bin[\s\S]*WHISPER_MODEL_PATH/,
    );
  });

  test('throws descriptive error when module loader fails', () => {
    expect(() => loadWhisperFactory(undefined, mockThrowingLoader)).toThrow(
      /Package 'whisper\.cpp' is required for transcription[\s\S]*Hint:[\s\S]*download_whisper_cpp/,
    );
    expect(() => loadWhisperFactory(undefined, mockNonFunctionLoader)).toThrow(
      /Package 'whisper\.cpp' is required for transcription[\s\S]*Hint:[\s\S]*download_whisper_cpp/,
    );
  });
});

describe('loadWhisperFactory local package resolution', () => {
  test('resolves factory from target directory when local module exists', () => {
    const mockWhisperDirectory = path.join(LOCAL_PACKAGE_ROOT, 'node_modules', 'whisper.cpp');
    fs.mkdirSync(mockWhisperDirectory, { recursive: true });
    fs.writeFileSync(path.join(mockWhisperDirectory, 'package.json'), JSON.stringify({ name: 'whisper.cpp', main: 'index.js' }));
    fs.writeFileSync(path.join(mockWhisperDirectory, 'index.js'), 'module.exports = function() { return Promise.resolve({ init: () => true }); };');

    const localFactory = loadWhisperFactory(
      undefined,
      () => {
        throw new Error('not in global');
      },
      LOCAL_PACKAGE_ROOT,
    );
    expect(typeof localFactory).toBe('function');
  });

  test('falls through to error when target directory localRequire fails or returns non-function', () => {
    const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-empty-${process.pid}-`));
    try {
      expect(() =>
        loadWhisperFactory(
          undefined,
          () => {
            throw new Error('not in global');
          },
          emptyDirectory,
        ),
      ).toThrow(/Package 'whisper\.cpp' is required for transcription/);
    } finally {
      fs.rmSync(emptyDirectory, { recursive: true, force: true });
    }
  });
});

describe('transcribe default model network error handling', () => {
  test('handles network failure with actionable hints', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('Connection timed out')));
    const testContext = createTestContext();

    try {
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            language: 'en',
          },
          testContext,
        ),
      ).rejects.toThrow(/Failed to download default model from[\s\S]*Connection timed out[\s\S]*Hint:/);
    } finally {
      homedirSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe('transcribe default model HTTP error handling', () => {
  test('handles HTTP error status with recovery hint', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: HTTP_STATUS_SERVICE_UNAVAILABLE,
        statusText: 'Service Unavailable',
      } as Response),
    );
    const testContext = createTestContext();

    try {
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            language: 'en',
          },
          testContext,
        ),
      ).rejects.toThrow(/Failed to download default model \(503 Service Unavailable\)[\s\S]*Hint:/);
    } finally {
      homedirSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe('transcribe default model download success and caching', () => {
  test('downloads default model and reuses cached file on subsequent calls', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    let fetchCallCount = 0;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true,
        status: HTTP_STATUS_OK,
        statusText: 'OK',
        arrayBuffer: () => Promise.resolve(Buffer.from('ggml-downloaded-model-content')),
      } as Response);
    });
    const testContext = createTestContext();

    try {
      const firstOutput = (await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
        },
        testContext,
      )) as string;
      expect(typeof firstOutput).toBe('string');
      expect(fetchCallCount).toBe(1);

      const secondOutput = (await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
        },
        testContext,
      )) as string;
      expect(secondOutput).toBe(firstOutput);
      expect(fetchCallCount).toBe(1);
    } finally {
      homedirSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});
