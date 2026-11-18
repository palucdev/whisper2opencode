import { execFileSync } from 'node:child_process';
import { accessSync, rmSync } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import type { ConvertAudioOptions, ResolveMediaOptions, SupportedConvertFormat } from '../types/whisper-types.js';
import { FLOAT32_BYTES_PER_SAMPLE, VIDEO_EXTENSIONS } from './audio-constants.js';
import { buildConvertArguments, getFfmpegBinary, handleConvertError, runFfmpegDecode } from './ffmpeg-runner.js';

export { DEFAULT_AUDIO_SAMPLE_RATE, SAMPLE_RATE } from './audio-constants.js';
export { getFfmpegBinary } from './ffmpeg-runner.js';

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getFileType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const category = isVideoFile(filePath) ? 'video' : 'audio';
  return extension ? `${category}/${extension}` : category;
}

const validateMediaStat = (stat: Stats, context: { label: string; resolvedPath: string }): void => {
  if (stat.isDirectory()) {
    throw new Error(
      `Path is a directory, not an audio or video file: ${context.resolvedPath}. Hint: List the files inside "${context.resolvedPath}" first and pass the path to a specific audio or video file.`,
    );
  }
  if (stat.size === 0) {
    throw new Error(`${context.label} is empty (0 bytes): ${context.resolvedPath}. Hint: Check that the file was properly written or downloaded.`);
  }
};

const extractResolveOptions = (inputOrOptions: ResolveMediaOptions | string | undefined, restArguments: unknown[]): ResolveMediaOptions => {
  if (inputOrOptions && typeof inputOrOptions === 'object') {
    return inputOrOptions;
  }
  return {
    inputPath: inputOrOptions,
    baseDirectory: typeof restArguments[0] === 'string' ? restArguments[0] : process.cwd(),
    argumentName: restArguments[1] === 'inputPath' ? 'inputPath' : 'filePath',
  };
};

export async function resolveMediaFile(
  inputOrOptions: ResolveMediaOptions | string | undefined,
  ...restArguments: unknown[]
): Promise<{ resolvedPath: string; stat: Stats }> {
  const { inputPath, baseDirectory, argumentName } = extractResolveOptions(inputOrOptions, restArguments);
  const label = argumentName === 'filePath' ? 'Audio/video file' : 'Source media file';
  if (!inputPath?.trim()) {
    throw new Error(`Missing required '${argumentName}' argument. Hint: Provide a valid path to an audio or video file.`);
  }

  const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDirectory, inputPath);

  let stat: Stats;
  try {
    stat = await Bun.file(resolvedPath).stat();
  } catch (error) {
    throw new Error(
      `${label} not found: ${resolvedPath}. Hint: Verify the file path using glob or list tools (resolved relative to "${baseDirectory}"), and pass an existing absolute path.`,
      { cause: error },
    );
  }

  validateMediaStat(stat, { label, resolvedPath });

  return { resolvedPath, stat };
}

function isSamePath(path1: string, path2: string): boolean {
  const normalizedPath1 = path.resolve(path1);
  const normalizedPath2 = path.resolve(path2);
  return process.platform === 'win32' ? normalizedPath1.toLowerCase() === normalizedPath2.toLowerCase() : normalizedPath1 === normalizedPath2;
}

const pcmBytesToFloat32 = (pcmBuffer: Buffer): Float32Array => {
  const sampleCount = Math.floor(pcmBuffer.byteLength / FLOAT32_BYTES_PER_SAMPLE);
  const isAligned = pcmBuffer.byteOffset % FLOAT32_BYTES_PER_SAMPLE === 0;
  return isAligned
    ? new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, sampleCount)
    : new Float32Array(pcmBuffer.buffer.slice(pcmBuffer.byteOffset, pcmBuffer.byteOffset + sampleCount * FLOAT32_BYTES_PER_SAMPLE));
};

const decodePcmf32File = async (mediaPath: string): Promise<Float32Array> => {
  const raw = Buffer.from(await Bun.file(mediaPath).arrayBuffer());
  const samples = pcmBytesToFloat32(raw);
  if (samples.length === 0) {
    throw new Error(
      `Decoded audio from "${mediaPath}" contains 0 samples. Hint: The .pcmf32 file is empty or smaller than 4 bytes. Regenerate the file as 16kHz mono 32-bit float PCM or pass the original audio/video file.`,
    );
  }
  return samples;
};

const bufferToFloat32Array = (pcmBuffer: Buffer, mediaPath: string): Float32Array => {
  const samples = pcmBytesToFloat32(pcmBuffer);
  if (samples.length === 0) {
    throw new Error(
      `Decoded audio from "${mediaPath}" contains 0 samples. Hint: The audio stream is empty or has zero duration. Check the source file or convert it to a valid 16kHz mono .wav file.`,
    );
  }
  return samples;
};

export async function decodeAudioToFloat32(mediaPath: string): Promise<Float32Array> {
  if (mediaPath.toLowerCase().endsWith('.pcmf32')) {
    return decodePcmf32File(mediaPath);
  }
  const ffmpegPath = getFfmpegBinary();
  const pcmBuffer = runFfmpegDecode(ffmpegPath, mediaPath);
  return bufferToFloat32Array(pcmBuffer, mediaPath);
}

const resolveDestinationPath = (options: ConvertAudioOptions, context: { resolvedInputPath: string; baseDirectory: string }): string => {
  const targetFormat = options.format ?? 'wav';
  if (options.outputPath?.trim()) {
    return path.isAbsolute(options.outputPath) ? options.outputPath : path.resolve(context.baseDirectory, options.outputPath);
  }
  const parsed = path.parse(context.resolvedInputPath);
  const candidate = path.join(parsed.dir, `${parsed.name}.${targetFormat}`);
  return isSamePath(candidate, context.resolvedInputPath) ? path.join(parsed.dir, `${parsed.name}.converted.${targetFormat}`) : candidate;
};

const canAccess = (targetPath: string): boolean => {
  try {
    accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
};

const prepareOutputDirectory = async (resolvedOutputPath: string): Promise<string | undefined> => {
  const parentDirectory = path.dirname(resolvedOutputPath);
  if (canAccess(parentDirectory)) {
    return undefined;
  }
  const markerPath = path.join(parentDirectory, '.w2oc-convert-marker');
  await Bun.write(markerPath, '');
  return markerPath;
};

const validateOutputWithinDirectory = (resolvedOutputPath: string, baseDirectory: string): void => {
  const relativeToBase = path.relative(baseDirectory, resolvedOutputPath);
  if (!relativeToBase || relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    throw new Error(
      `Output path "${resolvedOutputPath}" is outside the working directory "${baseDirectory}". Hint: Provide an 'outputPath' inside the current working directory without '..' traversal.`,
    );
  }
};

const validateOutputCollision = (resolvedOutputPath: string, options: { resolvedInputPath: string; isOverwrite: boolean }): void => {
  if (isSamePath(resolvedOutputPath, options.resolvedInputPath)) {
    throw new Error(
      `Output path "${resolvedOutputPath}" cannot be the same as input path. Hint: Provide a distinct 'outputPath' or omit 'outputPath' so a separate converted file is created.`,
    );
  }
  if (!options.isOverwrite && canAccess(resolvedOutputPath)) {
    throw new Error(`Output file already exists: ${resolvedOutputPath}. Hint: Set 'overwrite: true' or choose a different 'outputPath'.`);
  }
};

export async function convertAudioFile(options: ConvertAudioOptions): Promise<string> {
  const baseDirectory = path.resolve(options.directory ?? process.cwd());
  const { resolvedPath: resolvedInputPath } = await resolveMediaFile({
    inputPath: options.inputPath,
    baseDirectory,
    argumentName: 'inputPath',
  });
  const targetFormat: SupportedConvertFormat = options.format ?? 'wav';
  const isOverwrite = options.isOverwrite ?? options.overwrite ?? true;
  const resolvedOutputPath = resolveDestinationPath(options, { resolvedInputPath, baseDirectory });

  validateOutputWithinDirectory(resolvedOutputPath, baseDirectory);
  validateOutputCollision(resolvedOutputPath, { resolvedInputPath, isOverwrite });

  const markerPath = await prepareOutputDirectory(resolvedOutputPath);

  const ffmpegPath = getFfmpegBinary();
  const commandArguments = buildConvertArguments(options, { resolvedInputPath, resolvedOutputPath });

  try {
    execFileSync(ffmpegPath, commandArguments, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    handleConvertError(error, { resolvedInputPath, targetFormat });
  } finally {
    if (markerPath) {
      rmSync(markerPath, { force: true });
    }
  }

  return resolvedOutputPath;
}
