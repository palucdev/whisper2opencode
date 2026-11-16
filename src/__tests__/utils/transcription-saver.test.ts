import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { fileSystem } from '../../utils/file-system.js';
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
  test('writes a .txt file with a metadata header and appends the extension', () => {
    const savedPath = saveTranscriptionFile({
      filePath: 'transcripts/notes',
      sourceFile: 'jfk.wav',
      duration: DURATION,
      content: BODY,
      directory: TEST_ROOT,
    });

    expect(savedPath).toBe(path.join(TEST_ROOT, 'transcripts', 'notes.txt'));
    expect(fileSystem.readFileSync(savedPath, 'utf8')).toBe(`---\nsource_file: jfk.wav\nduration: ${DURATION}\n---\n\n${BODY}`);
  });

  test('rejects overwriting existing files and non-txt extensions', () => {
    fileSystem.writeFileSync(path.join(TEST_ROOT, 'existing.txt'), 'existing');
    expect(() =>
      saveTranscriptionFile({ filePath: 'existing.txt', sourceFile: 'jfk.wav', duration: DURATION, content: BODY, directory: TEST_ROOT }),
    ).toThrow(/already exists/);
    expect(() => saveTranscriptionFile({ filePath: 'notes.js', content: BODY, directory: TEST_ROOT })).toThrow(/Only "\.txt"/);
  });

  test('rejects paths outside the working directory, hidden paths, and empty input', () => {
    expect(() => saveTranscriptionFile({ filePath: '../outside.txt', content: BODY, directory: TEST_ROOT })).toThrow(/outside the working directory/);
    expect(() => saveTranscriptionFile({ filePath: '.env', content: BODY, directory: TEST_ROOT })).toThrow(/hidden files/);
    expect(() => saveTranscriptionFile({ filePath: '  ', content: BODY, directory: TEST_ROOT })).toThrow(/Missing required 'filePath'/);
    expect(() => saveTranscriptionFile({ filePath: 'notes.txt', content: '  ', directory: TEST_ROOT })).toThrow(/Missing or empty 'content'/);
  });
});
