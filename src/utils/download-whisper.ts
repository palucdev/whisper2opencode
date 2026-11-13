import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { DownloadWhisperOptions, DownloadWhisperResult, SupportedPackageManager } from '../types/whisper-types.js';

export const NPM_PACKAGE_NAME = 'whisper.cpp';
export const NPM_PACKAGE_VERSION = '1.0.3';
export const NPM_REGISTRY_TARBALL_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/-/${NPM_PACKAGE_NAME}-${NPM_PACKAGE_VERSION}.tgz`;
export const DEFAULT_MODEL_NAME = 'base.en';
export const HUGGINGFACE_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const MODEL_ALIASES: Record<string, string> = {
  tiny: 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  small: 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  medium: 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
  'large-v1': 'ggml-large-v1.bin',
  'large-v2': 'ggml-large-v2.bin',
  'large-v3': 'ggml-large-v3.bin',
  large: 'ggml-large-v3.bin',
};

/**
 * Normalizes user-specified model names into canonical GGML filenames (e.g. 'base.en' -> 'ggml-base.en.bin').
 */
export function resolveModelFileName(name?: string): string {
  const trimmed = name?.trim().toLowerCase();
  if (!trimmed) {
    return 'ggml-base.en.bin';
  }

  if (trimmed.endsWith('.bin')) {
    return trimmed.startsWith('ggml-') ? trimmed : `ggml-${trimmed}`;
  }

  return MODEL_ALIASES[trimmed] ?? `ggml-${trimmed}.bin`;
}

/**
 * Detects the appropriate package manager for the current directory setup.
 * Inspects lockfiles in targetDir and parent directories, falling back to runtime detection (Bun vs Node).
 */
export function detectPackageManager(targetDir: string): SupportedPackageManager {
  let curr = path.resolve(targetDir);
  const root = path.parse(curr).root;

  while (curr && curr !== root) {
    if (fs.existsSync(path.join(curr, 'bun.lock')) || fs.existsSync(path.join(curr, 'bun.lockb'))) {
      return 'bun';
    }
    if (fs.existsSync(path.join(curr, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (fs.existsSync(path.join(curr, 'yarn.lock'))) {
      return 'yarn';
    }
    if (fs.existsSync(path.join(curr, 'package-lock.json'))) {
      return 'npm';
    }
    curr = path.dirname(curr);
  }

  // Runtime fallback
  if (typeof (process.versions as Record<string, string | undefined>).bun === 'string') {
    return 'bun';
  }

  return 'npm';
}

/**
 * Pure JavaScript tar extractor for unpacked gzip buffers.
 * Unpacks the `package/` folder of an npm package directly into `targetDir`.
 */
export function unpackTarballBuffer(tarBuffer: Buffer, targetDir: string): void {
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    // 512 consecutive zero bytes indicate end of archive
    if (header.every((byte) => byte === 0)) break;

    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '').trim();
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const typeFlag = String.fromCharCode(header[156] || 48); // '0' or '\0' is normal file, '5' is dir
    const size = parseInt(sizeOctal, 8) || 0;

    offset += 512;

    if (rawName && (typeFlag === '0' || typeFlag === '\0')) {
      const relativePath = rawName.replace(/^package\//, '');
      const outFilePath = path.join(targetDir, relativePath);
      fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
      fs.writeFileSync(outFilePath, tarBuffer.subarray(offset, offset + size));
    }

    offset += Math.ceil(size / 512) * 512;
  }
}

/**
 * Downloads the whisper.cpp npm package tarball directly from the npm registry
 * and extracts it into <targetDir>/node_modules/whisper.cpp.
 */
export async function downloadPackageFromRegistry(targetDir: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const nodeModulesDir = path.join(targetDir, 'node_modules', NPM_PACKAGE_NAME);
  fs.mkdirSync(nodeModulesDir, { recursive: true });

  let response: Response;
  try {
    response = await fetchImpl(NPM_REGISTRY_TARBALL_URL);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to download '${NPM_PACKAGE_NAME}' from npm registry (${detail}). Hint: Check internet connection or retry.`);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download '${NPM_PACKAGE_NAME}' from npm registry (${response.status} ${response.statusText}). Hint: Verify registry access or package name.`,
    );
  }

  const arrayBuf = await response.arrayBuffer();
  const compressedBuffer = Buffer.from(arrayBuf);
  const tarBuffer = zlib.gunzipSync(compressedBuffer);

  unpackTarballBuffer(tarBuffer, nodeModulesDir);
  return nodeModulesDir;
}

/**
 * Installs whisper.cpp into the target directory using the detected package manager,
 * falling back to direct npm registry extraction if package manager CLI execution fails.
 */
export async function installWhisperPackage(
  targetDir: string,
  packageManager: SupportedPackageManager,
  options?: {
    processRunner?: typeof execFileSync;
    fetchImpl?: typeof fetch;
  },
): Promise<{ status: string; method: 'cli' | 'registry'; path: string }> {
  const runner = options?.processRunner ?? execFileSync;
  fs.mkdirSync(targetDir, { recursive: true });

  const pmCommands: Record<SupportedPackageManager, { cmd: string; args: string[] }> = {
    bun: { cmd: 'bun', args: ['add', NPM_PACKAGE_NAME] },
    pnpm: { cmd: 'pnpm', args: ['add', NPM_PACKAGE_NAME] },
    yarn: { cmd: 'yarn', args: ['add', NPM_PACKAGE_NAME] },
    npm: { cmd: 'npm', args: ['install', NPM_PACKAGE_NAME] },
  };

  const { cmd, args } = pmCommands[packageManager];

  try {
    runner(cmd, args, {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const installedPath = path.join(targetDir, 'node_modules', NPM_PACKAGE_NAME);
    return {
      status: `Successfully installed '${NPM_PACKAGE_NAME}' using ${packageManager}`,
      method: 'cli',
      path: installedPath,
    };
  } catch (cliErr) {
    // Fall back to direct download and extraction from npm registry
    try {
      const extractedPath = await downloadPackageFromRegistry(targetDir, options?.fetchImpl);
      return {
        status: `Installed '${NPM_PACKAGE_NAME}' via direct npm registry download (${cmd} command failed or was unavailable)`,
        method: 'registry',
        path: extractedPath,
      };
    } catch (fallbackErr) {
      const cliDetail = cliErr instanceof Error ? cliErr.message : String(cliErr);
      const fallbackDetail = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(
        `Failed to install '${NPM_PACKAGE_NAME}' using ${packageManager} (${cliDetail}), and direct registry download also failed (${fallbackDetail}).\n\n` +
          `Hint: Run '${packageManager === 'npm' ? 'npm install' : `${packageManager} add`} whisper.cpp' manually in "${targetDir}".`,
      );
    }
  }
}

/**
 * Downloads a GGML model file from Hugging Face if not already present in the user cache directory.
 */
export async function downloadGgmlModel(
  modelName: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ modelPath: string; status: 'cached' | 'downloaded' }> {
  const resolvedFileName = resolveModelFileName(modelName);
  const cacheDir = path.join(os.homedir(), '.cache', 'whisper2opencode');
  const cachedModelPath = path.join(cacheDir, resolvedFileName);

  if (fs.existsSync(cachedModelPath) && fs.statSync(cachedModelPath).size > 0) {
    return { modelPath: cachedModelPath, status: 'cached' };
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const modelUrl = `${HUGGINGFACE_MODEL_BASE_URL}/${resolvedFileName}`;

  let response: Response;
  try {
    response = await fetchImpl(modelUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to download model "${resolvedFileName}" from ${modelUrl} (${detail}).\n\n` +
        `Hint: Download manually using: curl -L -o ~/.cache/whisper2opencode/${resolvedFileName} ${modelUrl}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download model "${resolvedFileName}" (${response.status} ${response.statusText}).\n\n` +
        `Hint: Verify the model name ("${modelName}"). Available models include 'tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small'.`,
    );
  }

  const tmpPath = `${cachedModelPath}.tmp-${process.pid}-${Date.now()}`;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, cachedModelPath);

  return { modelPath: cachedModelPath, status: 'downloaded' };
}

/**
 * Orchestrates downloading and configuring whisper.cpp and the speech recognition model
 * for the current runtime and directory setup.
 */
export async function downloadWhisperSetup(
  options: DownloadWhisperOptions & {
    processRunner?: typeof execFileSync;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<DownloadWhisperResult> {
  const targetDir = path.resolve(options.directory ?? process.cwd());
  const pm = options.packageManager ?? detectPackageManager(targetDir);

  const pkgResult = await installWhisperPackage(targetDir, pm, {
    processRunner: options.processRunner,
    fetchImpl: options.fetchImpl,
  });

  let modelResult: { modelPath: string; status: 'cached' | 'downloaded' } | undefined;
  const canonicalModelName = resolveModelFileName(options.modelName ?? DEFAULT_MODEL_NAME);

  if (!options.skipModel) {
    modelResult = await downloadGgmlModel(canonicalModelName, options.fetchImpl);
  }

  const lines = [`Setup Directory: ${targetDir}`, `Package Manager: ${pm}`, `whisper.cpp Package: ${pkgResult.status} (${pkgResult.path})`];

  if (modelResult) {
    lines.push(
      `GGML Model (${canonicalModelName}): ${modelResult.status === 'cached' ? 'Already cached' : 'Downloaded successfully'} at ${modelResult.modelPath}`,
    );
  } else {
    lines.push('GGML Model: Skipped upon request');
  }

  lines.push('whisper.cpp transcription is ready to use.');

  return {
    packageManager: pm,
    directory: targetDir,
    packageStatus: pkgResult.status,
    modelName: canonicalModelName,
    modelPath: modelResult?.modelPath,
    modelStatus: modelResult?.status,
    summary: lines.join('\n'),
  };
}
