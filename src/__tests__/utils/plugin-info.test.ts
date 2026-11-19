import { describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_VERSION, parsePluginVersion, readPluginVersion } from '../../utils/plugin-info.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.join(__dirname, '../../..');

describe('plugin-info version resolution', () => {
  test('matches the version in the repository package.json', () => {
    const packageJsonPath = path.join(repositoryRoot, 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string };
    expect(PLUGIN_VERSION).toBe(packageContent.version);
  });

  test('resolves from the default plugin root', () => {
    expect(readPluginVersion()).toBe(PLUGIN_VERSION);
  });

  test('reads a semantic version from raw package.json content', () => {
    expect(parsePluginVersion(JSON.stringify({ version: '1.2.3' }))).toBe('1.2.3');
  });

  test("returns 'unknown' when package.json cannot be read", () => {
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation((() => {
      throw new Error('ENOENT: no such file or directory');
    }) as unknown as typeof fs.readFileSync);
    try {
      expect(readPluginVersion()).toBe('unknown');
    } finally {
      readFileSpy.mockRestore();
    }
  });

  test("returns 'unknown' when package.json is not valid JSON", () => {
    expect(parsePluginVersion('not-json{')).toBe('unknown');
  });

  test("returns 'unknown' when the version field is absent", () => {
    expect(parsePluginVersion(JSON.stringify({ name: 'whisper2opencode' }))).toBe('unknown');
  });

  test("returns 'unknown' when the version field is not a non-empty string", () => {
    expect(parsePluginVersion(JSON.stringify({ version: 123 }))).toBe('unknown');
    expect(parsePluginVersion(JSON.stringify({ version: '' }))).toBe('unknown');
  });
});
