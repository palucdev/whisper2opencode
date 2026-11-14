import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadGgmlModel, downloadWhisperSetup, resolveModelFileName } from '../../utils/download-whisper.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_FOUND = 404;
const PADDED_SPACES_COUNT = 3;
const TEST_HOME_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'model-download', 'home');
const TEST_PROJECT_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'model-download', 'project');
const EXPECTED_TINY_MODEL_PATH = path.join(TEST_HOME_ROOT, '.cache', 'whisper2opencode', 'ggml-tiny.en.bin');

const mockFetchSuccessModel = () =>
  Promise.resolve({
    ok: true,
    status: HTTP_STATUS_OK,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(Buffer.from('mock-ggml-model-bytes')),
  } as Response);

const mockNetworkErrorFetch = () => Promise.reject(new Error('Network offline'));

const mockNotFoundFetch = () =>
  Promise.resolve({
    ok: false,
    status: HTTP_STATUS_NOT_FOUND,
    statusText: 'Not Found',
  } as Response);

const mockSetupRunner = () => Buffer.alloc(0);

const mockSetupFetch = () =>
  Promise.resolve({
    ok: true,
    status: HTTP_STATUS_OK,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(Buffer.from('mock-model')),
  } as Response);

describe('model filename resolution', () => {
  test('maps aliases and handles raw filenames', () => {
    expect(resolveModelFileName()).toBe('ggml-base.en.bin');
    expect(resolveModelFileName(' '.repeat(PADDED_SPACES_COUNT))).toBe('ggml-base.en.bin');
    expect(resolveModelFileName('base.en')).toBe('ggml-base.en.bin');
    expect(resolveModelFileName('tiny.en')).toBe('ggml-tiny.en.bin');
    expect(resolveModelFileName('tiny')).toBe('ggml-tiny.bin');
    expect(resolveModelFileName('base')).toBe('ggml-base.bin');
    expect(resolveModelFileName('small.en')).toBe('ggml-small.en.bin');
    expect(resolveModelFileName('small')).toBe('ggml-small.bin');
    expect(resolveModelFileName('large-v3')).toBe('ggml-large-v3.bin');
    expect(resolveModelFileName('large')).toBe('ggml-large-v3.bin');
    expect(resolveModelFileName('ggml-custom.bin')).toBe('ggml-custom.bin');
    expect(resolveModelFileName('custom.bin')).toBe('ggml-custom.bin');
    expect(resolveModelFileName('unknown-model')).toBe('ggml-unknown-model.bin');
  });
});

describe('downloadGgmlModel cache operations', () => {
  beforeEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_HOME_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
  });

  test('downloads model from Hugging Face on cache miss', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    try {
      const result = await downloadGgmlModel('tiny.en', mockFetchSuccessModel as unknown as typeof fetch);
      expect(result.status).toBe('downloaded');
      expect(result.modelPath).toBe(EXPECTED_TINY_MODEL_PATH);
      expect(fs.existsSync(EXPECTED_TINY_MODEL_PATH)).toBe(true);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  test('reuses cached model on subsequent calls', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    try {
      const firstResult = await downloadGgmlModel('tiny.en', mockFetchSuccessModel as unknown as typeof fetch);
      let isSecondFetchCalled = false;
      const secondFetch = () => {
        isSecondFetchCalled = true;
        return Promise.reject(new Error('Should not be called'));
      };
      const secondResult = await downloadGgmlModel('tiny.en', secondFetch as unknown as typeof fetch);
      expect(secondResult.status).toBe('cached');
      expect(secondResult.modelPath).toBe(firstResult.modelPath);
      expect(isSecondFetchCalled).toBe(false);
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

describe('downloadGgmlModel error handling', () => {
  beforeEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_HOME_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
  });

  test('handles network and HTTP errors with actionable hints', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    try {
      await expect(downloadGgmlModel('base', mockNetworkErrorFetch as unknown as typeof fetch)).rejects.toThrow(
        /Failed to download model "ggml-base\.bin" from[\s\S]*Network offline[\s\S]*Hint:/,
      );

      await expect(downloadGgmlModel('base', mockNotFoundFetch as unknown as typeof fetch)).rejects.toThrow(
        /Failed to download model "ggml-base\.bin" \(404 Not Found\)[\s\S]*Hint:/,
      );
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

describe('downloadWhisperSetup full run', () => {
  beforeEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
    fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_HOME_ROOT, { recursive: true });
    fs.mkdirSync(TEST_PROJECT_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
    fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
  });

  test('orchestrates full setup with default model', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    try {
      const setupResult = await downloadWhisperSetup({
        directory: TEST_PROJECT_ROOT,
        packageManager: 'bun',
        processRunner: mockSetupRunner as unknown as typeof import('node:child_process').execFileSync,
        fetchImpl: mockSetupFetch as unknown as typeof fetch,
      });

      expect(setupResult.packageManager).toBe('bun');
      expect(setupResult.directory).toBe(TEST_PROJECT_ROOT);
      expect(setupResult.modelName).toBe('ggml-base.en.bin');
      expect(setupResult.modelStatus).toBe('downloaded');
      expect(setupResult.summary).toContain('Setup Directory:');
      expect(setupResult.summary).toContain('Package Manager: bun');
      expect(setupResult.summary).toContain("Successfully installed 'whisper.cpp'");
      expect(setupResult.summary).toContain('whisper.cpp transcription is ready to use.');
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

describe('downloadWhisperSetup skipped model', () => {
  beforeEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
    fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_HOME_ROOT, { recursive: true });
    fs.mkdirSync(TEST_PROJECT_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME_ROOT, { recursive: true, force: true });
    fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
  });

  test('orchestrates setup skipping model download upon request', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME_ROOT);
    try {
      const skipModelResult = await downloadWhisperSetup({
        directory: TEST_PROJECT_ROOT,
        packageManager: 'npm',
        skipModel: true,
        processRunner: mockSetupRunner as unknown as typeof import('node:child_process').execFileSync,
      });

      expect(skipModelResult.packageManager).toBe('npm');
      expect(skipModelResult.modelStatus).toBeUndefined();
      expect(skipModelResult.summary).toContain('GGML Model: Skipped upon request');
    } finally {
      homedirSpy.mockRestore();
    }
  });
});
