import { describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';

import { loadMarkdownDirectory } from '../../utils/file-utility.js';

const EXPECTED_MOCK_FILE_COUNT = 2;
const EXPECTED_SINGLE_FILE_COUNT = 1;

describe('file-utility loadMarkdownDirectory: filesystem reading', () => {
  test('returns empty array when directory does not exist', () => {
    const result = loadMarkdownDirectory('nonexistent-dir');
    expect(result).toEqual([]);
  });

  test('parses real markdown files from agents directory', () => {
    const results = loadMarkdownDirectory('agents');
    expect(results.length).toBeGreaterThan(0);
    const transcriber = results.find((element) => element.data.name === 'transcriber');
    expect(transcriber).toBeDefined();
    expect(transcriber?.data.mode).toBe('subagent');
  });
});

describe('file-utility loadMarkdownDirectory: mocked scenarios', () => {
  test('parses mocked markdown files and ignores non-markdown files', () => {
    const mockFiles = ['doc1.md', 'doc2.md', 'ignore.txt'];
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue(mockFiles as unknown as ReturnType<typeof fs.readdirSync>);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((filePath: unknown) => {
      const fileName = String(filePath);
      return fileName.endsWith('doc1.md')
        ? '---\nname: doc1\ndescription: First doc\n---\nDoc 1 content'
        : '---\nname: doc2\ndescription: Second doc\n---\nDoc 2 content';
    }) as unknown as typeof fs.readFileSync);

    try {
      const results = loadMarkdownDirectory('any-dir');
      expect(results).toHaveLength(EXPECTED_MOCK_FILE_COUNT);
      const names = results.map((element) => String(element.data.name)).toSorted((first, second) => first.localeCompare(second));
      expect(names).toEqual(['doc1', 'doc2']);
    } finally {
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
    }
  });

  test('skips unparseable markdown files with warning and returns remaining files', () => {
    const mockFiles = ['valid.md', 'bad.md'];
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue(mockFiles as unknown as ReturnType<typeof fs.readdirSync>);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((filePath: unknown) => {
      const fileName = String(filePath);
      return fileName.endsWith('valid.md') ? '---\nname: valid\n---\nValid content' : '---\nname: [unclosed\n---\nBad content';
    }) as unknown as typeof fs.readFileSync);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const results = loadMarkdownDirectory('any-dir');
      expect(results).toHaveLength(EXPECTED_SINGLE_FILE_COUNT);
      expect(results[0]?.data.name).toBe('valid');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[whisper2opencode] Skipping unparseable markdown file bad.md in any-dir:'),
        expect.any(String),
      );
    } finally {
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
