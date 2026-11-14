import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { detectPackageManager, downloadPackageFromRegistry, installWhisperPackage, unpackTarballBuffer } from '../../utils/download-whisper.js';
import { fileSystem } from '../../utils/file-system.js';
import { TAR_BLOCK_SIZE, TAR_FILENAME_LIMIT, TAR_SIZE_LENGTH, TAR_SIZE_OFFSET, TAR_TYPE_OFFSET } from '../../utils/tar-utility.js';
import { createMinimalTarGz } from '../fixtures.js';

const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_OK = 200;
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'package-manager');
const EXPECTED_PACKAGE_PATH = path.join(TEST_ROOT, 'node_modules', 'whisper.cpp');
const EXPECTED_EXTRACTED_FILE = path.join(EXPECTED_PACKAGE_PATH, 'whisper.js');

const mockNetworkFailureFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'));

const mockNotFoundFetch = (): Promise<Response> =>
  Promise.resolve({
    ok: false,
    status: HTTP_STATUS_NOT_FOUND,
    statusText: 'Not Found',
  } as Response);

const mockBunMissingRunner = (): never => {
  throw new Error('bun command not found in PATH');
};

const mockNpmFailingRunner = (): never => {
  throw new Error('npm execution failed');
};

const mockEmptyRunner = () => Buffer.alloc(0);

const mockRegistryUnreachableFetch = (): Promise<Response> => Promise.reject(new Error('Registry unreachable'));

const createMockRegistryFetch = (archiveData: Buffer) => (): Promise<Response> =>
  Promise.resolve({
    ok: true,
    status: HTTP_STATUS_OK,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(archiveData),
  } as Response);

describe('detectPackageManager detection', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('inspects lockfiles across project directories', () => {
    const bunDirectory = path.join(TEST_ROOT, 'bun-project');
    fs.mkdirSync(bunDirectory);
    fs.writeFileSync(path.join(bunDirectory, 'bun.lock'), '');
    expect(detectPackageManager(bunDirectory)).toBe('bun');

    const pnpmDirectory = path.join(TEST_ROOT, 'pnpm-project');
    fs.mkdirSync(pnpmDirectory);
    fs.writeFileSync(path.join(pnpmDirectory, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(pnpmDirectory)).toBe('pnpm');

    const yarnDirectory = path.join(TEST_ROOT, 'yarn-project');
    fs.mkdirSync(yarnDirectory);
    fs.writeFileSync(path.join(yarnDirectory, 'yarn.lock'), '');
    expect(detectPackageManager(yarnDirectory)).toBe('yarn');

    const npmDirectory = path.join(TEST_ROOT, 'npm-project');
    fs.mkdirSync(npmDirectory);
    fs.writeFileSync(path.join(npmDirectory, 'package-lock.json'), '');
    expect(detectPackageManager(npmDirectory)).toBe('npm');
  });

  test('inherits parent lockfile and falls back to runtime', () => {
    const bunDirectory = path.join(TEST_ROOT, 'bun-project');
    const nestedDirectory = path.join(bunDirectory, 'src', 'components');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.writeFileSync(path.join(bunDirectory, 'bun.lock'), '');
    expect(detectPackageManager(nestedDirectory)).toBe('bun');

    const isolatedDirectory = path.join(TEST_ROOT, 'isolated-runtime');
    const versions = process.versions as Record<string, string | undefined>;
    const originalBun = versions.bun;
    const lockfileSpy: { mockRestore: () => void } = spyOn(fileSystem, 'existsSync').mockReturnValue(false);
    try {
      versions.bun = '1.3.0-test';
      expect(detectPackageManager(isolatedDirectory)).toBe('bun');

      delete versions.bun;
      expect(detectPackageManager(isolatedDirectory)).toBe('npm');
    } finally {
      lockfileSpy.mockRestore();
      if (originalBun !== undefined) versions.bun = originalBun;
    }
  });
});

describe('tarball extraction and registry download', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('unpackTarballBuffer unpacks tar archive buffers', () => {
    const archive = createMinimalTarGz('console.log("whisper");');
    const unzipped = zlib.gunzipSync(archive);

    const outDirectory = path.join(TEST_ROOT, 'unpacked');
    unpackTarballBuffer(unzipped, outDirectory);

    const extractedFile = path.join(outDirectory, 'whisper.js');
    expect(fs.existsSync(extractedFile)).toBe(true);
    expect(fs.readFileSync(extractedFile, 'utf8')).toBe('console.log("whisper");');
  });

  test('rejects tarball members that escape the extraction directory', () => {
    const tarBuffer = Buffer.alloc(TAR_BLOCK_SIZE);
    tarBuffer.write('../outside.js', 0, TAR_FILENAME_LIMIT, 'utf8');
    tarBuffer.write('00000000000\0', TAR_SIZE_OFFSET, TAR_SIZE_LENGTH, 'utf8');
    tarBuffer.write('0', TAR_TYPE_OFFSET, 1, 'utf8');

    expect(() => unpackTarballBuffer(tarBuffer, path.join(TEST_ROOT, 'safe'))).toThrow(
      /escapes the extraction directory[\s\S]*Hint:.*unsafe member path/,
    );
    expect(fs.existsSync(path.join(TEST_ROOT, 'outside.js'))).toBe(false);
  });

  test('downloadPackageFromRegistry fetches and extracts package tarball', async () => {
    const mockArchive = createMinimalTarGz('module.exports = {};');
    const mockFetch = createMockRegistryFetch(mockArchive);

    const extractedPath = await downloadPackageFromRegistry(TEST_ROOT, mockFetch as unknown as typeof fetch);
    expect(extractedPath).toBe(EXPECTED_PACKAGE_PATH);
    expect(fs.existsSync(EXPECTED_EXTRACTED_FILE)).toBe(true);
    expect(fs.readFileSync(EXPECTED_EXTRACTED_FILE, 'utf8')).toBe('module.exports = {};');
  });

  test('downloadPackageFromRegistry handles network and HTTP errors', async () => {
    await expect(downloadPackageFromRegistry(TEST_ROOT, mockNetworkFailureFetch as unknown as typeof fetch)).rejects.toThrow(
      /Failed to download 'whisper\.cpp' from npm registry[\s\S]*Connection refused[\s\S]*Hint:/,
    );

    await expect(downloadPackageFromRegistry(TEST_ROOT, mockNotFoundFetch as unknown as typeof fetch)).rejects.toThrow(
      /Failed to download 'whisper\.cpp' from npm registry \(404 Not Found\)[\s\S]*Hint:/,
    );
  });
});

describe('installWhisperPackage CLI execution', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('runs package manager CLI command successfully', async () => {
    const executed: { command: string; commandArguments: string[]; cwd?: string }[] = [];
    const mockRunner = (command: string, ...restArguments: unknown[]) => {
      const commandArguments = Array.isArray(restArguments[0]) ? (restArguments[0] as string[]) : [];
      const runnerOptions = restArguments[1] as { cwd?: string } | undefined;
      executed.push({ command, commandArguments: [...commandArguments], cwd: runnerOptions?.cwd });
      return Buffer.alloc(0);
    };

    const result = await installWhisperPackage({
      targetDirectory: TEST_ROOT,
      packageManager: 'bun',
      processRunner: mockRunner as unknown as typeof import('node:child_process').execFileSync,
    });

    expect(result.method).toBe('cli');
    expect(result.status).toContain("Successfully installed 'whisper.cpp' using bun");
    expect(executed).toHaveLength(1);
    expect(executed[0]?.command).toBe('bun');
    expect(executed[0]?.commandArguments).toEqual(['add', 'whisper.cpp']);
    expect(executed[0]?.cwd).toBe(TEST_ROOT);
  });

  test('supports legacy positional arguments for targetDirectory and packageManager', async () => {
    const result = await installWhisperPackage(TEST_ROOT, 'bun', {
      processRunner: mockEmptyRunner as unknown as typeof import('node:child_process').execFileSync,
    });
    expect(result.method).toBe('cli');
    expect(result.status).toContain("Successfully installed 'whisper.cpp' using bun");
  });
});

describe('installWhisperPackage fallback and error handling', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('falls back to direct registry download when CLI fails', async () => {
    const mockArchive = createMinimalTarGz('module.exports = {};');
    const mockFetch = createMockRegistryFetch(mockArchive);

    const result = await installWhisperPackage({
      targetDirectory: TEST_ROOT,
      packageManager: 'bun',
      processRunner: mockBunMissingRunner as unknown as typeof import('node:child_process').execFileSync,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.method).toBe('registry');
    expect(result.status).toContain('via direct npm registry download (bun command failed or was unavailable)');
    expect(fs.existsSync(EXPECTED_EXTRACTED_FILE)).toBe(true);
  });

  test('throws actionable error when both CLI and registry fallback fail', async () => {
    await expect(
      installWhisperPackage({
        targetDirectory: TEST_ROOT,
        packageManager: 'npm',
        processRunner: mockNpmFailingRunner as unknown as typeof import('node:child_process').execFileSync,
        fetchImpl: mockRegistryUnreachableFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Failed to install 'whisper\.cpp' using npm[\s\S]*Registry unreachable[\s\S]*Hint: Run 'npm install whisper\.cpp' manually/);
  });
});
