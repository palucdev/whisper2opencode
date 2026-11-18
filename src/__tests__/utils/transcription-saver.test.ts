import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { saveTranscriptionFile } from '../../utils/transcription-saver.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'transcription-saver');
const BODY = '[00:00:00.000 --> 00:00:00.500] Hello\n[00:00:00.500 --> 00:00:01.000] world';
const DURATION = '00:00:01.000 (1.00s)';

beforeEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('saveTranscriptionFile', () => {
  test('writes a .txt file into a nested path with a metadata header and appends the extension', async () => {
    const savedPath = await saveTranscriptionFile({
      filePath: 'transcripts/notes',
      sourceFile: 'jfk.wav',
      duration: DURATION,
      content: BODY,
      directory: TEST_ROOT,
    });

    const expectedPath = path.join(TEST_ROOT, 'transcripts', 'notes.txt');
    expect(savedPath).toBe(expectedPath);
    expect(fs.readFileSync(expectedPath, 'utf8')).toBe(`---\nsource_file: jfk.wav\nduration: ${DURATION}\n---\n\n${BODY}`);
  });

  test('rejects overwriting existing files and non-txt extensions', async () => {
    fs.writeFileSync(path.join(TEST_ROOT, 'existing.txt'), 'existing');
    await expect(
      saveTranscriptionFile({ filePath: 'existing.txt', sourceFile: 'jfk.wav', duration: DURATION, content: BODY, directory: TEST_ROOT }),
    ).rejects.toThrow(/already exists/);
    await expect(saveTranscriptionFile({ filePath: 'notes.js', content: BODY, directory: TEST_ROOT })).rejects.toThrow(/Only "\.txt"/);
  });

  test('rejects paths outside the working directory, hidden paths, and empty input', async () => {
    await expect(saveTranscriptionFile({ filePath: '../outside.txt', content: BODY, directory: TEST_ROOT })).rejects.toThrow(
      /outside the working directory/,
    );
    await expect(saveTranscriptionFile({ filePath: '.env', content: BODY, directory: TEST_ROOT })).rejects.toThrow(/hidden files/);
    await expect(saveTranscriptionFile({ filePath: '  ', content: BODY, directory: TEST_ROOT })).rejects.toThrow(/Missing required 'filePath'/);
    await expect(saveTranscriptionFile({ filePath: 'notes.txt', content: '  ', directory: TEST_ROOT })).rejects.toThrow(/Missing or empty 'content'/);
  });
});
