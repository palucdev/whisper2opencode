import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import '../mock-ffmpeg.js';
import { mockFfmpegState } from '../mock-ffmpeg.js';

import { convert_audio } from '../../tools/convert-audio.js';
import { MOCK_AUDIO_PATH, createTestContext } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'tool-convert-audio');

beforeEach(() => {
  mockFfmpegState.reset();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('convert_audio tool', () => {
  test('converts media using tool arguments and the context directory', async () => {
    const outputPath = (await convert_audio.execute(
      {
        inputPath: MOCK_AUDIO_PATH,
        outputPath: 'converted.pcmf32',
        format: 'pcmf32',
        sampleRate: 16_000,
        channels: 1,
        overwrite: true,
      },
      createTestContext(TEST_ROOT),
    )) as string;

    expect(outputPath).toBe(path.join(TEST_ROOT, 'converted.pcmf32'));
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  test('rejects missing input files', async () => {
    await expect(
      convert_audio.execute({ inputPath: path.join(TEST_ROOT, 'missing.mp4'), format: 'wav' }, createTestContext(TEST_ROOT)),
    ).rejects.toThrow(/not found/);
  });
});
