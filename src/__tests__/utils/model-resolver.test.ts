import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_MODEL_NAME, resolveModelPath } from '../../utils/model-resolver.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'model-resolver');
const TEST_HOME = path.join(TEST_ROOT, 'home');
const CACHE_DIRECTORY = path.join(TEST_HOME, '.cache', 'whisper2opencode');
const CACHED_MODEL_PATH = path.join(CACHE_DIRECTORY, DEFAULT_MODEL_NAME);
const environmentSource = Reflect.get(process, 'env') as Record<string, string | undefined>;
const originalModelPath = environmentSource.WHISPER_MODEL_PATH;

const setModelPath = (value?: string): void => {
  if (value === undefined) {
    Reflect.deleteProperty(environmentSource, 'WHISPER_MODEL_PATH');
  } else {
    Reflect.set(environmentSource, 'WHISPER_MODEL_PATH', value);
  }
};

const fetchModel = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(Buffer.from('mock-model')),
  } as unknown as Response);

beforeEach(() => {
  setModelPath();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  setModelPath(originalModelPath);
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('resolveModelPath custom models', () => {
  test('resolves explicit and environment-provided model paths', async () => {
    const modelFile = path.join(TEST_ROOT, 'custom.bin');
    fs.writeFileSync(modelFile, 'model');

    expect(await resolveModelPath(modelFile, TEST_ROOT)).toBe(modelFile);

    setModelPath(modelFile);
    expect(await resolveModelPath(undefined, TEST_ROOT)).toBe(modelFile);
  });

  test('rejects missing, directory, and empty model paths', async () => {
    await expect(resolveModelPath(path.join(TEST_ROOT, 'missing.bin'), TEST_ROOT)).rejects.toThrow(/not found/);

    const modelDirectory = path.join(TEST_ROOT, 'model-dir');
    fs.mkdirSync(modelDirectory);
    await expect(resolveModelPath(modelDirectory, TEST_ROOT)).rejects.toThrow(/is a directory/);

    const emptyModel = path.join(TEST_ROOT, 'empty.bin');
    fs.writeFileSync(emptyModel, '');
    await expect(resolveModelPath(emptyModel, TEST_ROOT)).rejects.toThrow(/file is empty/);
  });
});

describe('resolveModelPath default model', () => {
  test('reuses a cached default model without downloading', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
      fs.writeFileSync(CACHED_MODEL_PATH, 'cached-model');

      expect(await resolveModelPath(undefined, TEST_ROOT)).toBe(CACHED_MODEL_PATH);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  test('downloads the default model on a cache miss', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(fetchModel as unknown as typeof fetch);
    try {
      expect(await resolveModelPath(undefined, TEST_ROOT)).toBe(CACHED_MODEL_PATH);
      expect(fs.existsSync(CACHED_MODEL_PATH)).toBe(true);
    } finally {
      homedirSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  test('surfaces network and HTTP errors', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      const networkSpy = spyOn(globalThis, 'fetch').mockImplementation((() => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
      try {
        await expect(resolveModelPath(undefined, TEST_ROOT)).rejects.toThrow(/offline/);
      } finally {
        networkSpy.mockRestore();
      }

      const httpErrorSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
        Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' } as unknown as Response)) as unknown as typeof fetch);
      try {
        await expect(resolveModelPath(undefined, TEST_ROOT)).rejects.toThrow(/503 Service Unavailable/);
      } finally {
        httpErrorSpy.mockRestore();
      }
    } finally {
      homedirSpy.mockRestore();
    }
  });
});
