import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { DownloadWhisperOptions, DownloadWhisperResult, InstallWhisperPackageOptions } from '../types/whisper-types.js';
import { hasValidCachedModel, persistModelToCache } from './model-resolver.js';

export { unpackTarballBuffer } from './tar-utility.js';
import { unpackTarballBuffer } from './tar-utility.js';

export const NPM_PACKAGE_NAME = 'whisper.cpp';
export const NPM_PACKAGE_VERSION = '1.0.3';
export const NPM_REGISTRY_TARBALL_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/-/${NPM_PACKAGE_NAME}-${NPM_PACKAGE_VERSION}.tgz`;
export const DEFAULT_MODEL_NAME = 'base.en';
export const HUGGINGFACE_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const MODEL_ALIASES = new Map<string, string>([['large', 'ggml-large-v3.bin']]);

const MODEL_FILE_NAME_PATTERN = /^ggml-[a-z0-9][a-z0-9._-]*\.bin$/;

// Normalizes user-specified model names into canonical GGML filenames (e.g. 'base.en' -> 'ggml-base.en.bin').
export function resolveModelFileName(name?: string): string {
  const trimmed = name?.trim().toLowerCase();
  if (!trimmed) return 'ggml-base.en.bin';
  const bare = trimmed.replace(/^ggml-/, '').replace(/\.bin$/, '');
  const resolved = MODEL_ALIASES.get(bare) ?? `ggml-${bare}.bin`;
  if (!MODEL_FILE_NAME_PATTERN.test(resolved)) {
    throw new Error(
      `Invalid model name "${name}". Hint: Use a simple model name such as 'tiny.en', 'base.en', or 'small'; path separators and traversal sequences are not allowed.`,
    );
  }
  return resolved;
}

// Downloads the whisper.cpp npm package tarball directly from the npm registry
// and extracts it into <targetDirectory>/node_modules/whisper.cpp.
export async function downloadPackageFromRegistry(targetDirectory: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const nodeModulesDirectory = path.join(targetDirectory, 'node_modules', NPM_PACKAGE_NAME);

  let response: Response;
  try {
    response = await fetchImpl(NPM_REGISTRY_TARBALL_URL);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download '${NPM_PACKAGE_NAME}' from npm registry (${detail}). Hint: Check internet connection or retry.`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download '${NPM_PACKAGE_NAME}' from npm registry (${response.status} ${response.statusText}). Hint: Verify registry access or package name.`,
    );
  }

  const compressedBuffer = Buffer.from(await response.arrayBuffer());
  const tarBuffer = zlib.gunzipSync(compressedBuffer);

  await unpackTarballBuffer(tarBuffer, nodeModulesDirectory);
  return nodeModulesDirectory;
}

// Installs whisper.cpp into the target directory using bun, falling back to direct npm registry
// extraction if the bun CLI execution fails.
export async function installWhisperPackage(
  options: InstallWhisperPackageOptions,
): Promise<{ status: string; method: 'cli' | 'registry'; path: string }> {
  const { targetDirectory } = options;
  const runner = options.processRunner ?? execFileSync;

  try {
    runner('bun', ['add', NPM_PACKAGE_NAME], {
      cwd: targetDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const installedPath = path.join(targetDirectory, 'node_modules', NPM_PACKAGE_NAME);
    return {
      status: `Successfully installed '${NPM_PACKAGE_NAME}' using bun`,
      method: 'cli',
      path: installedPath,
    };
  } catch (cliError) {
    try {
      const extractedPath = await downloadPackageFromRegistry(targetDirectory, options.fetchImpl);
      return {
        status: `Installed '${NPM_PACKAGE_NAME}' via direct npm registry download (bun add command failed or was unavailable)`,
        method: 'registry',
        path: extractedPath,
      };
    } catch (fallbackError) {
      const cliDetail = cliError instanceof Error ? cliError.message : String(cliError);
      const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Failed to install '${NPM_PACKAGE_NAME}' using bun (${cliDetail}), and direct registry download also failed (${fallbackDetail}).\n\n` +
          `Hint: Run 'bun add ${NPM_PACKAGE_NAME}' manually in "${targetDirectory}".`,
        { cause: fallbackError },
      );
    }
  }
}

// Downloads a GGML model file from Hugging Face if not already present in the user cache directory.
export async function downloadGgmlModel(
  modelName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ modelPath: string; status: 'cached' | 'downloaded' }> {
  const resolvedFileName = resolveModelFileName(modelName);
  const cacheDirectory = path.join(os.homedir(), '.cache', 'whisper2opencode');
  const cachedModelPath = path.join(cacheDirectory, resolvedFileName);

  if (await hasValidCachedModel(cachedModelPath)) {
    return { modelPath: cachedModelPath, status: 'cached' };
  }

  const modelUrl = `${HUGGINGFACE_MODEL_BASE_URL}/${resolvedFileName}`;

  let response: Response;
  try {
    response = await fetchImpl(modelUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to download model "${resolvedFileName}" from ${modelUrl} (${detail}).\n\n` +
        `Hint: Download manually using: curl -L -o ~/.cache/whisper2opencode/${resolvedFileName} ${modelUrl}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download model "${resolvedFileName}" (${response.status} ${response.statusText}).\n\n` +
        `Hint: Verify the model name ("${modelName}"). Available models include 'tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small'.`,
    );
  }

  await persistModelToCache(cachedModelPath, response);

  return { modelPath: cachedModelPath, status: 'downloaded' };
}

const formatModelStatusLine = (
  modelResult: { modelPath: string; status: 'cached' | 'downloaded' } | undefined,
  canonicalModelName: string,
): string => {
  if (!modelResult) {
    return 'GGML Model: Skipped upon request';
  }
  const statusLabel = modelResult.status === 'cached' ? 'Already cached' : 'Downloaded successfully';
  return `GGML Model (${canonicalModelName}): ${statusLabel} at ${modelResult.modelPath}`;
};

// Orchestrates downloading and configuring whisper.cpp and the speech recognition model
// for the current directory setup.
export async function downloadWhisperSetup(
  options: DownloadWhisperOptions & {
    processRunner?: typeof execFileSync;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<DownloadWhisperResult> {
  const targetDirectory = path.resolve(options.directory ?? process.cwd());

  const packageResult = await installWhisperPackage({
    targetDirectory,
    processRunner: options.processRunner,
    fetchImpl: options.fetchImpl,
  });

  let modelResult: { modelPath: string; status: 'cached' | 'downloaded' } | undefined;
  const canonicalModelName = resolveModelFileName(options.modelName ?? DEFAULT_MODEL_NAME);

  if (!options.skipModel) {
    modelResult = await downloadGgmlModel(canonicalModelName, options.fetchImpl);
  }

  const lines = [
    `Setup Directory: ${targetDirectory}`,
    `whisper.cpp Package: ${packageResult.status} (${packageResult.path})`,
    formatModelStatusLine(modelResult, canonicalModelName),
    'whisper.cpp transcription is ready to use.',
  ];

  return {
    directory: targetDirectory,
    packageStatus: packageResult.status,
    modelName: canonicalModelName,
    modelPath: modelResult?.modelPath,
    modelStatus: modelResult?.status,
    summary: lines.join('\n'),
  };
}
