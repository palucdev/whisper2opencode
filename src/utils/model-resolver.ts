import type { Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvironmentConfig } from './environment-config.js';

export const DEFAULT_MODEL_NAME = 'ggml-base.en.bin';
export const DEFAULT_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}`;

const MODEL_SIZE_SIDECAR_SUFFIX = '.size';

export const hasValidCachedModel = async (modelPath: string): Promise<boolean> => {
  try {
    const stat = await Bun.file(modelPath).stat();
    if (stat.size === 0) {
      return false;
    }
    const sidecarContent = await Bun.file(`${modelPath}${MODEL_SIZE_SIDECAR_SUFFIX}`).text();
    const sidecarSize = Number(sidecarContent.trim());
    return Number.isFinite(sidecarSize) && sidecarSize === stat.size;
  } catch {
    return false;
  }
};

export const persistModelToCache = async (modelPath: string, buffer: Uint8Array): Promise<void> => {
  await Bun.write(modelPath, buffer);
  await Bun.write(`${modelPath}${MODEL_SIZE_SIDECAR_SUFFIX}`, String(buffer.byteLength));
};

const resolveCustomModelPath = async (configured: string, baseDirectory: string): Promise<string> => {
  const resolved = path.isAbsolute(configured) ? configured : path.resolve(baseDirectory, configured);
  let stat: Stats;
  try {
    stat = await Bun.file(resolved).stat();
  } catch (error) {
    throw new Error(
      `Whisper model file not found at: ${resolved}. Hint: Omit 'modelPath' to automatically use the default model (${DEFAULT_MODEL_NAME}), or verify the path to your local whisper.cpp GGML .bin model file.`,
      { cause: error },
    );
  }
  if (stat.isDirectory() || stat.size === 0) {
    throw new Error(
      `Whisper model path is invalid (${stat.isDirectory() ? 'is a directory' : 'file is empty'}): ${resolved}. Hint: Provide a valid non-empty whisper.cpp GGML .bin model file or omit 'modelPath' to use the default model.`,
    );
  }
  return resolved;
};

const downloadDefaultModel = async (cachedModelPath: string): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(DEFAULT_MODEL_URL);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to download default model from ${DEFAULT_MODEL_URL} (${detail}).\n\n` +
        "Hint: Use the 'download_whisper_cpp' tool to download the required speech model, or download it manually into your environment:\n" +
        '  mkdir -p ~/.cache/whisper2opencode\n' +
        '  curl -L -o ~/.cache/whisper2opencode/ggml-base.en.bin \\\n' +
        '    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin\n' +
        'Or set the WHISPER_MODEL_PATH environment variable to a local GGML .bin model file:\n' +
        '  export WHISPER_MODEL_PATH="/path/to/ggml-base.en.bin"',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download default model (${response.status} ${response.statusText}).\n\n` +
        "Hint: Use the 'download_whisper_cpp' tool to download the required speech model, or download it manually into your environment:\n" +
        '  mkdir -p ~/.cache/whisper2opencode\n' +
        '  curl -L -o ~/.cache/whisper2opencode/ggml-base.en.bin \\\n' +
        '    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin\n' +
        'Or set the WHISPER_MODEL_PATH environment variable to a local GGML .bin model file:\n' +
        '  export WHISPER_MODEL_PATH="/path/to/ggml-base.en.bin"',
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await persistModelToCache(cachedModelPath, buffer);
  return cachedModelPath;
};

export async function resolveModelPath(customModelPath: string | undefined, baseDirectory: string): Promise<string> {
  const configured = customModelPath ?? getEnvironmentConfig().whisperModelPath;
  if (configured) {
    return resolveCustomModelPath(configured, baseDirectory);
  }

  const cacheDirectory = path.join(os.homedir(), '.cache', 'whisper2opencode');
  const cachedModelPath = path.join(cacheDirectory, DEFAULT_MODEL_NAME);
  return (await hasValidCachedModel(cachedModelPath)) ? cachedModelPath : downloadDefaultModel(cachedModelPath);
}
