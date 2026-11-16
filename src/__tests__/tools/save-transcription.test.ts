import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { save_transcription } from '../../tools/save-transcription.js';
import { fileSystem } from '../../utils/file-system.js';
import { createTestContext } from '../fixtures.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'tool-save-transcription');
const BODY = '[00:00:00.000 --> 00:00:00.500] Hello\n[00:00:00.500 --> 00:00:01.000] world';

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('save_transcription tool', () => {
  test('saves a transcription file inside the context directory', async () => {
    const savedPath = (await save_transcription.execute(
      {
        filePath: 'notes',
        sourceFile: 'jfk.wav',
        duration: '00:00:01.000 (1.00s)',
        content: BODY,
      },
      createTestContext(TEST_ROOT),
    )) as string;

    expect(savedPath).toBe(path.join(TEST_ROOT, 'notes.txt'));
    expect(fileSystem.readFileSync(savedPath, 'utf8')).toBe('---\nsource_file: jfk.wav\nduration: 00:00:01.000 (1.00s)\n---\n\n' + BODY);
  });
});
