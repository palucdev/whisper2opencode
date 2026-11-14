import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_VERSION, readPluginVersion } from '../../utils/plugin-info.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.join(__dirname, '../../..');
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'plugin-info');

const makePluginRoot = (packageJsonContent?: string): string => {
  const root = path.join(TEST_ROOT, 'dist');
  fs.mkdirSync(root, { recursive: true });
  if (packageJsonContent !== undefined) {
    fs.writeFileSync(path.join(TEST_ROOT, 'package.json'), packageJsonContent, 'utf8');
  }
  return root;
};

describe('plugin-info version resolution', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('matches the version in the repository package.json', () => {
    const packageJsonPath = path.join(repositoryRoot, 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string };
    expect(PLUGIN_VERSION).toBe(packageContent.version);
  });

  test('resolves from the default plugin root', () => {
    expect(readPluginVersion()).toBe(PLUGIN_VERSION);
  });

  test('reads the version from package.json above the plugin root', () => {
    const root = makePluginRoot(JSON.stringify({ version: '1.2.3' }));
    expect(readPluginVersion(root)).toBe('1.2.3');
  });

  test("returns 'unknown' when package.json is missing", () => {
    const root = makePluginRoot();
    expect(readPluginVersion(root)).toBe('unknown');
  });

  test("returns 'unknown' when package.json is not valid JSON", () => {
    const root = makePluginRoot('not-json{');
    expect(readPluginVersion(root)).toBe('unknown');
  });

  test("returns 'unknown' when the version field is absent", () => {
    const root = makePluginRoot(JSON.stringify({ name: 'whisper2opencode' }));
    expect(readPluginVersion(root)).toBe('unknown');
  });

  test("returns 'unknown' when the version field is not a non-empty string", () => {
    const invalidNumberVersionRoot = makePluginRoot(JSON.stringify({ version: 123 }));
    expect(readPluginVersion(invalidNumberVersionRoot)).toBe('unknown');

    const emptyStringVersionRoot = makePluginRoot(JSON.stringify({ version: '' }));
    expect(readPluginVersion(emptyStringVersionRoot)).toBe('unknown');
  });
});
