import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { download_whisper, download_whisper_cpp } from '../../tools/download-whisper-cpp.js';
import type { DownloadWhisperOptions } from '../../types/whisper-types.js';
import * as downloadWhisperModule from '../../utils/download-whisper.js';
import { createTestContext } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'tool-download-whisper-cpp');

const mockSetup = (capture: (options: DownloadWhisperOptions) => void) =>
  spyOn(downloadWhisperModule, 'downloadWhisperSetup').mockImplementation((options) => {
    const resolvedOptions = options ?? {};
    capture(resolvedOptions);
    return Promise.resolve({
      packageManager: resolvedOptions.packageManager ?? 'bun',
      directory: resolvedOptions.directory ?? '',
      packageStatus: 'installed',
      summary: 'Mock setup completed successfully.',
    });
  });

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('download_whisper_cpp tool', () => {
  test('exposes setup arguments and keeps the download_whisper alias', () => {
    expect(download_whisper).toBe(download_whisper_cpp);
    expect(download_whisper_cpp.args.packageManager).toBeDefined();
    expect(download_whisper_cpp.args.modelName).toBeDefined();
    expect(download_whisper_cpp.args.skipModel).toBeDefined();
    expect(download_whisper_cpp.args.directory).toBeDefined();
  });

  test('passes explicit options to downloadWhisperSetup', async () => {
    let capturedOptions: DownloadWhisperOptions | undefined;
    const setupSpy = mockSetup((options) => (capturedOptions = options));

    try {
      const customDirectory = path.join(TEST_ROOT, 'custom-workspace');
      const output = await download_whisper_cpp.execute(
        { packageManager: 'bun', modelName: 'tiny.en', skipModel: true, directory: customDirectory },
        createTestContext(TEST_ROOT),
      );

      expect(output).toBe('Mock setup completed successfully.');
      expect(capturedOptions).toMatchObject({
        packageManager: 'bun',
        modelName: 'tiny.en',
        skipModel: true,
        directory: customDirectory,
      });
    } finally {
      setupSpy.mockRestore();
    }
  });

  test('defaults the directory to the plugin context', async () => {
    let capturedOptions: DownloadWhisperOptions | undefined;
    const setupSpy = mockSetup((options) => (capturedOptions = options));

    try {
      await download_whisper.execute({}, createTestContext(TEST_ROOT));
      expect(capturedOptions?.directory).toBe(TEST_ROOT);
    } finally {
      setupSpy.mockRestore();
    }
  });
});
