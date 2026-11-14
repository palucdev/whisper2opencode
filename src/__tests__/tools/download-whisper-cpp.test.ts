import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { download_whisper, download_whisper_cpp } from '../../tools/download-whisper-cpp.js';
import type { DownloadWhisperOptions } from '../../types/whisper-types.js';
import * as downloadWhisperModule from '../../utils/download-whisper.js';
import { createTestContext } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'tool-download-whisper-cpp');

describe('download_whisper_cpp schema and metadata', () => {
  test('tool definition has descriptive metadata and arguments schema', () => {
    expect(download_whisper_cpp).toBeDefined();
    expect(download_whisper_cpp.description).toContain('whisper.cpp');
    expect(download_whisper_cpp.args.packageManager).toBeDefined();
    expect(download_whisper_cpp.args.modelName).toBeDefined();
    expect(download_whisper_cpp.args.skipModel).toBeDefined();
    expect(download_whisper_cpp.args.directory).toBeDefined();
    expect(download_whisper).toBe(download_whisper_cpp);
  });
});

describe('download_whisper_cpp execution with explicit options', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    temporaryDirectory = TEST_ROOT;
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('executes downloadWhisperSetup with explicit options', async () => {
    let capturedOptions: DownloadWhisperOptions | undefined;
    const downloadSpy = spyOn(downloadWhisperModule, 'downloadWhisperSetup').mockImplementation((options) => {
      capturedOptions = options;
      return Promise.resolve({
        packageManager: options.packageManager ?? 'bun',
        directory: options.directory ?? '',
        packageStatus: 'installed',
        summary: 'Mock setup completed successfully.',
      });
    });

    const testContext = createTestContext(temporaryDirectory);
    try {
      const customDirectory = path.join(temporaryDirectory, 'custom-workspace');
      const output = await download_whisper_cpp.execute(
        {
          packageManager: 'bun',
          modelName: 'tiny.en',
          skipModel: true,
          directory: customDirectory,
        },
        testContext,
      );

      expect(output).toBe('Mock setup completed successfully.');
      expect(capturedOptions?.packageManager).toBe('bun');
      expect(capturedOptions?.modelName).toBe('tiny.en');
      expect(capturedOptions?.skipModel).toBe(true);
      expect(capturedOptions?.directory).toBe(customDirectory);
    } finally {
      downloadSpy.mockRestore();
    }
  });
});

describe('download_whisper_cpp execution with default options', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    temporaryDirectory = TEST_ROOT;
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('executes downloadWhisperSetup defaulting directory to context.directory', async () => {
    let capturedOptions: DownloadWhisperOptions | undefined;
    const downloadSpy = spyOn(downloadWhisperModule, 'downloadWhisperSetup').mockImplementation((options) => {
      capturedOptions = options;
      return Promise.resolve({
        packageManager: options.packageManager ?? 'bun',
        directory: options.directory ?? '',
        packageStatus: 'installed',
        summary: 'Mock setup completed successfully.',
      });
    });

    const testContext = createTestContext(temporaryDirectory);
    try {
      const output = await download_whisper.execute({}, testContext);
      expect(output).toBe('Mock setup completed successfully.');
      expect(capturedOptions?.packageManager).toBeUndefined();
      expect(capturedOptions?.modelName).toBeUndefined();
      expect(capturedOptions?.skipModel).toBeUndefined();
      expect(capturedOptions?.directory).toBe(temporaryDirectory);
    } finally {
      downloadSpy.mockRestore();
    }
  });
});
