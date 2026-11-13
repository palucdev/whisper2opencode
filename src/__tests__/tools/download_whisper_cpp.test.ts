import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download_whisper, download_whisper_cpp } from '../../tools/download_whisper_cpp.js';
import * as downloadUtil from '../../utils/download-whisper.js';
import { createTestContext } from '../fixtures.js';

describe('download_whisper_cpp tool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-tool-test-${process.pid}-`));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('tool definition has descriptive metadata and arguments schema', () => {
    expect(download_whisper_cpp).toBeDefined();
    expect(download_whisper_cpp.description).toContain('whisper.cpp');
    expect(download_whisper_cpp.args.packageManager).toBeDefined();
    expect(download_whisper_cpp.args.modelName).toBeDefined();
    expect(download_whisper_cpp.args.skipModel).toBeDefined();
    expect(download_whisper_cpp.args.directory).toBeDefined();
    expect(download_whisper).toBe(download_whisper_cpp);
  });

  test('executes downloadWhisperSetup with arguments and defaults directory to context.directory', async () => {
    let capturedOptions: any;
    const downloadSpy = spyOn(downloadUtil, 'downloadWhisperSetup').mockImplementation((opts: any) => {
      capturedOptions = opts;
      return Promise.resolve({
        packageManager: opts.packageManager ?? 'bun',
        directory: opts.directory,
        packageStatus: 'installed',
        summary: 'Mock setup completed successfully.',
      });
    });

    const ctx = createTestContext(tempDir);
    try {
      // 1. Invoked with explicit args
      const customDir = path.join(tempDir, 'custom-workspace');
      const output1 = await download_whisper_cpp.execute(
        {
          packageManager: 'bun',
          modelName: 'tiny.en',
          skipModel: true,
          directory: customDir,
        },
        ctx,
      );

      expect(output1).toBe('Mock setup completed successfully.');
      expect(capturedOptions.packageManager).toBe('bun');
      expect(capturedOptions.modelName).toBe('tiny.en');
      expect(capturedOptions.skipModel).toBe(true);
      expect(capturedOptions.directory).toBe(customDir);

      // 2. Invoked with default/omitted args (uses context.directory)
      const output2 = await download_whisper.execute({}, ctx);
      expect(output2).toBe('Mock setup completed successfully.');
      expect(capturedOptions.packageManager).toBeUndefined();
      expect(capturedOptions.modelName).toBeUndefined();
      expect(capturedOptions.skipModel).toBeUndefined();
      expect(capturedOptions.directory).toBe(tempDir);
    } finally {
      downloadSpy.mockRestore();
    }
  });
});
