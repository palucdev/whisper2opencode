import { describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';

import { loadMarkdownDir } from '../../utils/file-util.js';

describe('file-util loadMarkdownDir', () => {
  test('should return empty array when directory does not exist', () => {
    const result = loadMarkdownDir('nonexistent-dir');
    expect(result).toEqual([]);
  });

  test('should parse real markdown files from agents directory', () => {
    const results = loadMarkdownDir('agents');
    expect(results.length).toBeGreaterThan(0);
    const transcriber = results.find((r) => r.data.name === 'transcriber');
    expect(transcriber).toBeDefined();
    expect(transcriber?.data.mode).toBe('subagent');
  });

  test('should parse mocked markdown files and ignore non-markdown files', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue(['doc1.md', 'doc2.md', 'ignore.txt'] as any);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((file: any) => {
      if (String(file).endsWith('doc1.md')) {
        return '---\nname: doc1\ndescription: First doc\n---\nDoc 1 content';
      }
      return '---\nname: doc2\ndescription: Second doc\n---\nDoc 2 content';
    }) as any);

    try {
      const results = loadMarkdownDir('any-dir');
      expect(results.length).toBe(2);
      const names = results.map((r) => r.data.name).sort();
      expect(names).toEqual(['doc1', 'doc2']);
    } finally {
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
    }
  });

  test('should skip unparseable markdown files with warning and return remaining files', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue(['valid.md', 'bad.md'] as any);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((file: any) => {
      if (String(file).endsWith('valid.md')) {
        return '---\nname: valid\n---\nValid content';
      }
      return '---\nname: [unclosed\n---\nBad content';
    }) as any);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const results = loadMarkdownDir('any-dir');
      expect(results.length).toBe(1);
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
