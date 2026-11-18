import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  detectPackageManager,
  downloadGgmlModel,
  downloadWhisperSetup,
  installWhisperPackage,
  resolveModelFileName,
} from '../../utils/download-whisper.js';
import { createMinimalTarGz } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'download-whisper');
const TEST_HOME = path.join(TEST_ROOT, 'home');
const TEST_PROJECT = path.join(TEST_ROOT, 'project');
const EXPECTED_PACKAGE_PATH = path.join(TEST_PROJECT, 'node_modules', 'whisper.cpp');
const EXPECTED_EXTRACTED_FILE = path.join(EXPECTED_PACKAGE_PATH, 'whisper.js');
const CACHED_TINY_MODEL_PATH = path.join(TEST_HOME, '.cache', 'whisper2opencode', 'ggml-tiny.en.bin');
const CACHED_TINY_MODEL_SIDECAR_PATH = `${CACHED_TINY_MODEL_PATH}.size`;

const fetchModel = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(Buffer.from('mock-model')),
  } as unknown as Response);

const fetchTarball = () => {
  const archive = createMinimalTarGz('module.exports = {};');
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(archive),
  } as unknown as Response);
};

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_PROJECT, { recursive: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('resolveModelFileName', () => {
  test('normalizes defaults, aliases, and raw filenames', () => {
    expect(resolveModelFileName()).toBe('ggml-base.en.bin');
    expect(resolveModelFileName('tiny.en')).toBe('ggml-tiny.en.bin');
    expect(resolveModelFileName('large')).toBe('ggml-large-v3.bin');
    expect(resolveModelFileName('custom.bin')).toBe('ggml-custom.bin');
  });

  test('rejects traversal and path separator names', () => {
    expect(() => resolveModelFileName('../../etc/passwd.bin')).toThrow(/Invalid model name/);
    expect(() => resolveModelFileName('../ggml-evil.bin')).toThrow(/Invalid model name/);
    expect(() => resolveModelFileName('nested/model.bin')).toThrow(/Invalid model name/);
    expect(() => resolveModelFileName('/opt/ggml-evil.bin')).toThrow(/Invalid model name/);
  });
});

describe('detectPackageManager', () => {
  test('detects lockfiles in the project and parent directories', () => {
    fs.writeFileSync(path.join(TEST_PROJECT, 'bun.lock'), '');
    expect(detectPackageManager(TEST_PROJECT)).toBe('bun');

    const nestedDirectory = path.join(TEST_PROJECT, 'src', 'components');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    expect(detectPackageManager(nestedDirectory)).toBe('bun');

    fs.rmSync(path.join(TEST_PROJECT, 'bun.lock'));
    fs.writeFileSync(path.join(TEST_PROJECT, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(TEST_PROJECT)).toBe('pnpm');
  });

  test('falls back to the runtime when no lockfile exists', () => {
    const lockfileSpy: { mockRestore: () => void } = spyOn(fs, 'accessSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    try {
      expect(['bun', 'npm']).toContain(detectPackageManager(TEST_PROJECT));
    } finally {
      lockfileSpy.mockRestore();
    }
  });
});

describe('installWhisperPackage', () => {
  test('runs the package manager CLI and reports success', async () => {
    const executed: { command: string; commandArguments: string[]; cwd?: string }[] = [];
    const runner = (command: string, ...restArguments: unknown[]) => {
      const commandArguments = Array.isArray(restArguments[0]) ? (restArguments[0] as string[]) : [];
      const runnerOptions = restArguments[1] as { cwd?: string } | undefined;
      executed.push({ command, commandArguments: [...commandArguments], cwd: runnerOptions?.cwd });
      return Buffer.alloc(0);
    };

    const result = await installWhisperPackage({
      targetDirectory: TEST_PROJECT,
      packageManager: 'bun',
      processRunner: runner as unknown as typeof import('node:child_process').execFileSync,
    });

    expect(result).toMatchObject({ method: 'cli', path: EXPECTED_PACKAGE_PATH });
    expect(executed).toEqual([{ command: 'bun', commandArguments: ['add', 'whisper.cpp'], cwd: TEST_PROJECT }]);
  });

  test('falls back to direct registry download when the CLI fails', async () => {
    const result = await installWhisperPackage({
      targetDirectory: TEST_PROJECT,
      packageManager: 'npm',
      processRunner: (() => {
        throw new Error('npm missing');
      }) as unknown as typeof import('node:child_process').execFileSync,
      fetchImpl: fetchTarball as unknown as typeof fetch,
    });

    expect(result.method).toBe('registry');
    expect(fs.existsSync(EXPECTED_EXTRACTED_FILE)).toBe(true);
  });

  test('throws when both the CLI and registry download fail', async () => {
    await expect(
      installWhisperPackage({
        targetDirectory: TEST_PROJECT,
        packageManager: 'npm',
        processRunner: (() => {
          throw new Error('npm missing');
        }) as unknown as typeof import('node:child_process').execFileSync,
        fetchImpl: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Failed to install 'whisper\.cpp'/);
  });
});

describe('downloadGgmlModel', () => {
  test('downloads a model and reuses the cached file', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      const firstResult = await downloadGgmlModel('tiny.en', fetchModel as unknown as typeof fetch);
      expect(firstResult.status).toBe('downloaded');
      expect(firstResult.modelPath).toBe(CACHED_TINY_MODEL_PATH);
      expect(fs.existsSync(CACHED_TINY_MODEL_PATH)).toBe(true);
      expect(fs.readFileSync(CACHED_TINY_MODEL_SIDECAR_PATH, 'utf8')).toBe(String(Buffer.byteLength('mock-model')));

      let isSecondFetchCalled = false;
      const secondResult = await downloadGgmlModel('tiny.en', (() => {
        isSecondFetchCalled = true;
        return Promise.reject(new Error('should not be called'));
      }) as unknown as typeof fetch);

      expect(secondResult.status).toBe('cached');
      expect(secondResult.modelPath).toBe(firstResult.modelPath);
      expect(isSecondFetchCalled).toBe(false);
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

describe('downloadGgmlModel cache invalidation', () => {
  test('re-downloads a cached model without a size sidecar', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      fs.mkdirSync(path.dirname(CACHED_TINY_MODEL_PATH), { recursive: true });
      fs.writeFileSync(CACHED_TINY_MODEL_PATH, 'stale-model');

      const result = await downloadGgmlModel('tiny.en', fetchModel as unknown as typeof fetch);

      expect(result.status).toBe('downloaded');
      expect(fs.readFileSync(CACHED_TINY_MODEL_PATH, 'utf8')).toBe('mock-model');
      expect(fs.readFileSync(CACHED_TINY_MODEL_SIDECAR_PATH, 'utf8')).toBe(String(Buffer.byteLength('mock-model')));
    } finally {
      homedirSpy.mockRestore();
    }
  });

  test('re-downloads a cached model with a mismatched sidecar size', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      fs.mkdirSync(path.dirname(CACHED_TINY_MODEL_PATH), { recursive: true });
      fs.writeFileSync(CACHED_TINY_MODEL_PATH, 'stale-model');
      fs.writeFileSync(CACHED_TINY_MODEL_SIDECAR_PATH, '1');

      const result = await downloadGgmlModel('tiny.en', fetchModel as unknown as typeof fetch);

      expect(result.status).toBe('downloaded');
      expect(fs.readFileSync(CACHED_TINY_MODEL_PATH, 'utf8')).toBe('mock-model');
      expect(fs.readFileSync(CACHED_TINY_MODEL_SIDECAR_PATH, 'utf8')).toBe(String(Buffer.byteLength('mock-model')));
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

describe('downloadGgmlModel errors', () => {
  test('surfaces network and HTTP errors', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      await expect(downloadGgmlModel('base', (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).rejects.toThrow(/offline/);
      await expect(
        downloadGgmlModel('base', (() =>
          Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' } as unknown as Response)) as unknown as typeof fetch),
      ).rejects.toThrow(/404 Not Found/);
    } finally {
      homedirSpy.mockRestore();
    }
  });
});

describe('downloadWhisperSetup', () => {
  test('orchestrates package installation and model download', async () => {
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(TEST_HOME);
    try {
      const result = await downloadWhisperSetup({
        directory: TEST_PROJECT,
        packageManager: 'bun',
        processRunner: (() => Buffer.alloc(0)) as unknown as typeof import('node:child_process').execFileSync,
        fetchImpl: fetchModel as unknown as typeof fetch,
      });

      expect(result).toMatchObject({
        packageManager: 'bun',
        directory: TEST_PROJECT,
        modelName: 'ggml-base.en.bin',
        modelStatus: 'downloaded',
      });
      expect(result.summary).toContain('whisper.cpp transcription is ready to use.');
    } finally {
      homedirSpy.mockRestore();
    }
  });

  test('skips the model download when requested', async () => {
    const result = await downloadWhisperSetup({
      directory: TEST_PROJECT,
      packageManager: 'npm',
      skipModel: true,
      processRunner: (() => Buffer.alloc(0)) as unknown as typeof import('node:child_process').execFileSync,
    });

    expect(result.modelStatus).toBeUndefined();
    expect(result.summary).toContain('GGML Model: Skipped upon request');
  });
});
