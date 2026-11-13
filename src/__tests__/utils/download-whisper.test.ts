import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  DEFAULT_MODEL_NAME,
  HUGGINGFACE_MODEL_BASE_URL,
  NPM_PACKAGE_NAME,
  NPM_REGISTRY_TARBALL_URL,
  detectPackageManager,
  downloadGgmlModel,
  downloadPackageFromRegistry,
  downloadWhisperSetup,
  installWhisperPackage,
  resolveModelFileName,
  unpackTarballBuffer,
} from '../../utils/download-whisper.js';

/**
 * Creates a minimal valid tar buffer containing a single file in 'package/<filename>'
 */
function createMinimalTarGz(filename: string, content: string): Buffer {
  const tarHeader = Buffer.alloc(512);
  const fullName = `package/${filename}`;
  tarHeader.write(fullName, 0, 100, 'utf8'); // name
  tarHeader.write('0000644\0', 100, 8, 'utf8'); // mode
  tarHeader.write('0000000\0', 108, 8, 'utf8'); // uid
  tarHeader.write('0000000\0', 116, 8, 'utf8'); // gid

  const contentBuf = Buffer.from(content, 'utf8');
  const sizeOctal = contentBuf.length.toString(8).padStart(11, '0') + '\0';
  tarHeader.write(sizeOctal, 124, 12, 'utf8'); // size
  tarHeader.write('00000000000\0', 136, 12, 'utf8'); // mtime
  tarHeader.write('        ', 148, 8, 'utf8'); // checksum placeholder
  tarHeader.write('0', 156, 1, 'utf8'); // typeflag (regular file)
  tarHeader.write('ustar\0', 257, 6, 'utf8'); // magic
  tarHeader.write('00', 263, 2, 'utf8'); // version

  // Compute checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += tarHeader[i]!;
  }
  const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
  tarHeader.write(checksumOctal, 148, 8, 'utf8');

  // Pad content to 512-byte boundary
  const padSize = Math.ceil(contentBuf.length / 512) * 512 - contentBuf.length;
  const padding = Buffer.alloc(padSize);
  const endBlocks = Buffer.alloc(1024); // Two 512-byte zero blocks

  const tarData = Buffer.concat([tarHeader, contentBuf, padding, endBlocks]);
  return zlib.gzipSync(tarData);
}

describe('download-whisper utility', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-download-test-${process.pid}-`));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('resolveModelFileName maps aliases and handles raw filenames', () => {
    expect(resolveModelFileName()).toBe('ggml-base.en.bin');
    expect(resolveModelFileName('   ')).toBe('ggml-base.en.bin');
    expect(resolveModelFileName('base.en')).toBe('ggml-base.en.bin');
    expect(resolveModelFileName('tiny.en')).toBe('ggml-tiny.en.bin');
    expect(resolveModelFileName('tiny')).toBe('ggml-tiny.bin');
    expect(resolveModelFileName('base')).toBe('ggml-base.bin');
    expect(resolveModelFileName('small.en')).toBe('ggml-small.en.bin');
    expect(resolveModelFileName('small')).toBe('ggml-small.bin');
    expect(resolveModelFileName('large-v3')).toBe('ggml-large-v3.bin');
    expect(resolveModelFileName('large')).toBe('ggml-large-v3.bin');
    expect(resolveModelFileName('ggml-custom.bin')).toBe('ggml-custom.bin');
    expect(resolveModelFileName('custom.bin')).toBe('ggml-custom.bin');
    expect(resolveModelFileName('unknown-model')).toBe('ggml-unknown-model.bin');
  });

  test('detectPackageManager inspects lockfiles and falls back to runtime', () => {
    // 1. bun.lock
    const bunDir = path.join(tempDir, 'bun-project');
    fs.mkdirSync(bunDir);
    fs.writeFileSync(path.join(bunDir, 'bun.lock'), '');
    expect(detectPackageManager(bunDir)).toBe('bun');

    // 2. pnpm-lock.yaml
    const pnpmDir = path.join(tempDir, 'pnpm-project');
    fs.mkdirSync(pnpmDir);
    fs.writeFileSync(path.join(pnpmDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(pnpmDir)).toBe('pnpm');

    // 3. yarn.lock
    const yarnDir = path.join(tempDir, 'yarn-project');
    fs.mkdirSync(yarnDir);
    fs.writeFileSync(path.join(yarnDir, 'yarn.lock'), '');
    expect(detectPackageManager(yarnDir)).toBe('yarn');

    // 4. package-lock.json
    const npmDir = path.join(tempDir, 'npm-project');
    fs.mkdirSync(npmDir);
    fs.writeFileSync(path.join(npmDir, 'package-lock.json'), '');
    expect(detectPackageManager(npmDir)).toBe('npm');

    // 5. Nested directory inherits parent lockfile
    const nestedDir = path.join(bunDir, 'src', 'components');
    fs.mkdirSync(nestedDir, { recursive: true });
    expect(detectPackageManager(nestedDir)).toBe('bun');

    // 6. Empty directory falls back to runtime
    const emptyDir = path.join(tempDir, 'empty-project');
    fs.mkdirSync(emptyDir);
    const expectedRuntime = typeof (process.versions as Record<string, string | undefined>).bun === 'string' ? 'bun' : 'npm';
    expect(detectPackageManager(emptyDir)).toBe(expectedRuntime);

    // 7. Falls back to npm when not running under bun
    const originalVersions = process.versions;
    try {
      const mockVersions = { ...originalVersions };
      delete (mockVersions as Record<string, string | undefined>).bun;
      Object.defineProperty(process, 'versions', {
        value: mockVersions,
        configurable: true,
      });
      expect(detectPackageManager(emptyDir)).toBe('npm');
    } finally {
      Object.defineProperty(process, 'versions', {
        value: originalVersions,
        configurable: true,
      });
    }
  });

  test('unpackTarballBuffer unpacks tar archive buffers', () => {
    const gz = createMinimalTarGz('whisper.js', 'console.log("whisper");');
    const unzipped = zlib.gunzipSync(gz);

    const outDir = path.join(tempDir, 'unpacked');
    unpackTarballBuffer(unzipped, outDir);

    const extractedFile = path.join(outDir, 'whisper.js');
    expect(fs.existsSync(extractedFile)).toBe(true);
    expect(fs.readFileSync(extractedFile, 'utf8')).toBe('console.log("whisper");');
  });

  test('downloadPackageFromRegistry fetches and extracts package tarball from npm registry', async () => {
    const mockTgz = createMinimalTarGz('whisper.js', 'module.exports = {};');
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: () => Promise.resolve(mockTgz),
      } as Response),
    );

    try {
      const extractedPath = await downloadPackageFromRegistry(tempDir, mockFetch as any);
      expect(extractedPath).toBe(path.join(tempDir, 'node_modules', NPM_PACKAGE_NAME));
      expect(fs.existsSync(path.join(extractedPath, 'whisper.js'))).toBe(true);
      expect(fs.readFileSync(path.join(extractedPath, 'whisper.js'), 'utf8')).toBe('module.exports = {};');
    } finally {
      mockFetch.mockRestore();
    }
  });

  test('downloadPackageFromRegistry handles network and HTTP errors with hints', async () => {
    // Network failure
    const netFetch = () => Promise.reject(new Error('Connection refused'));
    await expect(downloadPackageFromRegistry(tempDir, netFetch as any)).rejects.toThrow(
      /Failed to download 'whisper\.cpp' from npm registry[\s\S]*Connection refused[\s\S]*Hint:/,
    );

    // HTTP failure
    const httpFetch = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);
    await expect(downloadPackageFromRegistry(tempDir, httpFetch as any)).rejects.toThrow(
      /Failed to download 'whisper\.cpp' from npm registry \(404 Not Found\)[\s\S]*Hint:/,
    );
  });

  test('installWhisperPackage runs package manager CLI command successfully', async () => {
    const executed: { cmd: string; args: string[]; cwd: string }[] = [];
    const mockRunner = (cmd: string, args?: readonly string[], opts?: any) => {
      executed.push({ cmd, args: [...(args || [])], cwd: opts?.cwd });
      return Buffer.alloc(0);
    };

    const result = await installWhisperPackage(tempDir, 'bun', {
      processRunner: mockRunner as any,
    });

    expect(result.method).toBe('cli');
    expect(result.status).toContain("Successfully installed 'whisper.cpp' using bun");
    expect(executed.length).toBe(1);
    expect(executed[0]?.cmd).toBe('bun');
    expect(executed[0]?.args).toEqual(['add', 'whisper.cpp']);
    expect(executed[0]?.cwd).toBe(tempDir);
  });

  test('installWhisperPackage falls back to direct registry download when CLI fails', async () => {
    const mockTgz = createMinimalTarGz('whisper.js', 'module.exports = {};');
    const mockFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: () => Promise.resolve(mockTgz),
      } as Response);

    const failingRunner = () => {
      throw new Error('bun command not found in PATH');
    };

    const result = await installWhisperPackage(tempDir, 'bun', {
      processRunner: failingRunner as any,
      fetchImpl: mockFetch as any,
    });

    expect(result.method).toBe('registry');
    expect(result.status).toContain('via direct npm registry download (bun command failed or was unavailable)');
    expect(fs.existsSync(path.join(tempDir, 'node_modules', NPM_PACKAGE_NAME, 'whisper.js'))).toBe(true);
  });

  test('installWhisperPackage throws actionable error when both CLI and registry fallback fail', async () => {
    const failingRunner = () => {
      throw new Error('npm execution failed');
    };
    const failingFetch = () => Promise.reject(new Error('Registry unreachable'));

    await expect(
      installWhisperPackage(tempDir, 'npm', {
        processRunner: failingRunner as any,
        fetchImpl: failingFetch as any,
      }),
    ).rejects.toThrow(/Failed to install 'whisper\.cpp' using npm[\s\S]*Registry unreachable[\s\S]*Hint: Run 'npm install whisper\.cpp' manually/);
  });

  test('downloadGgmlModel checks cache and downloads models from Hugging Face with error handling', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-model-test-${process.pid}-`));
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(tempHome);

    try {
      // 1. Successful download
      let fetchUrl = '';
      const successFetch = (url: string | URL | Request) => {
        fetchUrl = String(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from('mock-ggml-model-bytes')),
        } as Response);
      };

      const result1 = await downloadGgmlModel('tiny.en', successFetch as any);
      expect(result1.status).toBe('downloaded');
      expect(result1.modelPath).toBe(path.join(tempHome, '.cache', 'whisper2opencode', 'ggml-tiny.en.bin'));
      expect(fetchUrl).toBe(`${HUGGINGFACE_MODEL_BASE_URL}/ggml-tiny.en.bin`);
      expect(fs.existsSync(result1.modelPath)).toBe(true);

      // 2. Re-uses cached model on subsequent call
      let secondFetchCalled = false;
      const secondFetch = () => {
        secondFetchCalled = true;
        return Promise.reject(new Error('Should not be called'));
      };
      const result2 = await downloadGgmlModel('tiny.en', secondFetch as any);
      expect(result2.status).toBe('cached');
      expect(result2.modelPath).toBe(result1.modelPath);
      expect(secondFetchCalled).toBe(false);

      // 3. Network error handling
      const netErrorFetch = () => Promise.reject(new Error('Network offline'));
      await expect(downloadGgmlModel('base', netErrorFetch as any)).rejects.toThrow(
        /Failed to download model "ggml-base\.bin" from[\s\S]*Network offline[\s\S]*Hint:/,
      );

      // 4. HTTP error handling
      const httpErrorFetch = () =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response);
      await expect(downloadGgmlModel('base', httpErrorFetch as any)).rejects.toThrow(
        /Failed to download model "ggml-base\.bin" \(404 Not Found\)[\s\S]*Hint:/,
      );
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test('downloadWhisperSetup orchestrates full installation and summary generation', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-setup-home-${process.pid}-`));
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(tempHome);

    try {
      const mockRunner = () => Buffer.alloc(0);
      const mockFetch = () =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from('mock-model')),
        } as Response);

      // Full run with default model
      const setupResult = await downloadWhisperSetup({
        directory: tempDir,
        packageManager: 'bun',
        processRunner: mockRunner as any,
        fetchImpl: mockFetch as any,
      });

      expect(setupResult.packageManager).toBe('bun');
      expect(setupResult.directory).toBe(tempDir);
      expect(setupResult.modelName).toBe('ggml-base.en.bin');
      expect(setupResult.modelStatus).toBe('downloaded');
      expect(setupResult.summary).toContain('Setup Directory:');
      expect(setupResult.summary).toContain('Package Manager: bun');
      expect(setupResult.summary).toContain("Successfully installed 'whisper.cpp'");
      expect(setupResult.summary).toContain('whisper.cpp transcription is ready to use.');

      // Run with skipModel: true
      const skipModelResult = await downloadWhisperSetup({
        directory: tempDir,
        packageManager: 'npm',
        skipModel: true,
        processRunner: mockRunner as any,
      });

      expect(skipModelResult.packageManager).toBe('npm');
      expect(skipModelResult.modelStatus).toBeUndefined();
      expect(skipModelResult.summary).toContain('GGML Model: Skipped upon request');
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
