import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ConvertAudioOptions, SupportedConvertFormat } from '../types/whisper-types.js';

const require = createRequire(import.meta.url);

export const SAMPLE_RATE = 16000;

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.webm',
  '.flv',
  '.m4v',
  '.ts',
  '.mts',
  '.m2ts',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.wmv',
  '.ogv',
  '.vob',
]);

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const category = isVideoFile(filePath) ? 'video' : 'audio';
  return ext ? `${category}/${ext}` : category;
}

export function resolveMediaFile(
  inputPath: string | undefined,
  baseDir: string,
  argName: 'filePath' | 'inputPath',
): { resolvedPath: string; stat: fs.Stats } {
  const label = argName === 'filePath' ? 'Audio/video file' : 'Source media file';
  if (!inputPath?.trim()) {
    throw new Error(`Missing required '${argName}' argument. Hint: Provide a valid path to an audio or video file.`);
  }

  const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `${label} not found: ${resolvedPath}. Hint: Verify the file path using glob or list tools (resolved relative to "${baseDir}"), and pass an existing absolute path.`,
    );
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(
      `Path is a directory, not an audio or video file: ${resolvedPath}. Hint: List the files inside "${resolvedPath}" first and pass the path to a specific audio or video file.`,
    );
  }
  if (stat.size === 0) {
    throw new Error(`${label} is empty (0 bytes): ${resolvedPath}. Hint: Check that the file was properly written or downloaded.`);
  }

  return { resolvedPath, stat };
}

export function getFfmpegBinary(overridePath?: unknown): string {
  const ffmpegRaw = overridePath !== undefined ? overridePath : (process.env.FFMPEG_PATH ?? (require('ffmpeg-static') as unknown));
  const ffmpegPath =
    typeof ffmpegRaw === 'string' && ffmpegRaw.trim()
      ? ffmpegRaw.trim()
      : ffmpegRaw && typeof ffmpegRaw === 'object' && 'default' in ffmpegRaw && typeof (ffmpegRaw as { default: unknown }).default === 'string'
        ? (ffmpegRaw as { default: string }).default.trim()
        : null;
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static binary is not available for this platform. Hint: Convert the input file to raw 16kHz mono 32-bit float PCM (.pcmf32) externally and pass the .pcmf32 file to 'transcribe'.",
    );
  }
  return ffmpegPath;
}

function formatFfmpegStderr(err: unknown): { raw: string; detail: string } {
  const raw =
    err && typeof err === 'object' && 'stderr' in err && Buffer.isBuffer(err.stderr)
      ? err.stderr.toString('utf8').trim()
      : err instanceof Error
        ? err.message
        : String(err);
  const detail = raw.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') || 'unknown ffmpeg error';
  return { raw, detail };
}

function isSamePath(path1: string, path2: string): boolean {
  const p1 = path.resolve(path1);
  const p2 = path.resolve(path2);
  return process.platform === 'win32' ? p1.toLowerCase() === p2.toLowerCase() : p1 === p2;
}

export function decodeAudioToFloat32(mediaPath: string): Float32Array {
  if (mediaPath.toLowerCase().endsWith('.pcmf32')) {
    const raw = fs.readFileSync(mediaPath);
    const sampleCount = Math.floor(raw.byteLength / 4);
    const samples =
      raw.byteOffset % 4 === 0
        ? new Float32Array(raw.buffer, raw.byteOffset, sampleCount)
        : new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + sampleCount * 4));
    if (samples.length === 0) {
      throw new Error(
        `Decoded audio from "${mediaPath}" contains 0 samples. Hint: The .pcmf32 file is empty or smaller than 4 bytes. Regenerate the file as 16kHz mono 32-bit float PCM or pass the original audio/video file.`,
      );
    }
    return samples;
  }

  const ffmpegPath = getFfmpegBinary();
  let pcmBuffer: Buffer;
  try {
    pcmBuffer = execFileSync(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        mediaPath,
        '-vn',
        '-map',
        '0:a:0',
        '-ar',
        String(SAMPLE_RATE),
        '-ac',
        '1',
        '-f',
        'f32le',
        '-acodec',
        'pcm_f32le',
        'pipe:1',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  } catch (err) {
    const { raw, detail } = formatFfmpegStderr(err);
    const action = isVideoFile(mediaPath) ? `Failed to isolate audio from video "${mediaPath}"` : `Failed to decode audio from "${mediaPath}"`;

    if (/does not contain any stream|matches no streams/i.test(raw)) {
      throw new Error(
        `${action}: no audio stream found (${detail}). Hint: Verify that the media file contains an audio stream before attempting transcription.`,
      );
    }

    if (/Invalid data found when processing input|Format .* detected only with low score|moov atom not found/i.test(raw)) {
      throw new Error(
        `${action}: invalid or corrupted media format (${detail}). Hint: Verify that the file is a valid audio/video recording or convert it to a 16kHz mono .wav file first.`,
      );
    }

    throw new Error(
      `${action}: ${detail}. Hint: Ensure the file is a valid audio or video file (.wav, .mp3, .m4a, .ogg, .flac, .webm, .mp4, .mkv, .mov, .pcmf32) or convert it to .wav before retrying.`,
    );
  }

  const sampleCount = Math.floor(pcmBuffer.byteLength / 4);
  const samples =
    pcmBuffer.byteOffset % 4 === 0
      ? new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, sampleCount)
      : new Float32Array(pcmBuffer.buffer.slice(pcmBuffer.byteOffset, pcmBuffer.byteOffset + sampleCount * 4));
  if (samples.length === 0) {
    throw new Error(
      `Decoded audio from "${mediaPath}" contains 0 samples. Hint: The audio stream is empty or has zero duration. Check the source file or convert it to a valid 16kHz mono .wav file.`,
    );
  }
  return samples;
}

export function convertAudioFile(options: ConvertAudioOptions): string {
  const baseDir = options.directory ?? process.cwd();
  const { resolvedPath: resolvedInputPath } = resolveMediaFile(options.inputPath, baseDir, 'inputPath');

  const targetFormat: SupportedConvertFormat = options.format ?? 'wav';
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const overwrite = options.overwrite ?? true;

  let resolvedOutputPath: string;
  if (options.outputPath?.trim()) {
    resolvedOutputPath = path.isAbsolute(options.outputPath) ? options.outputPath : path.resolve(baseDir, options.outputPath);
  } else {
    const parsed = path.parse(resolvedInputPath);
    const candidate = path.join(parsed.dir, `${parsed.name}.${targetFormat}`);
    resolvedOutputPath = isSamePath(candidate, resolvedInputPath) ? path.join(parsed.dir, `${parsed.name}.converted.${targetFormat}`) : candidate;
  }

  if (isSamePath(resolvedOutputPath, resolvedInputPath)) {
    throw new Error(
      `Output path "${resolvedOutputPath}" cannot be the same as input path. Hint: Provide a distinct 'outputPath' or omit 'outputPath' so a separate converted file is created.`,
    );
  }

  if (!overwrite && fs.existsSync(resolvedOutputPath)) {
    throw new Error(`Output file already exists: ${resolvedOutputPath}. Hint: Set 'overwrite: true' or choose a different 'outputPath'.`);
  }

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });

  const ffmpegPath = getFfmpegBinary();
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    overwrite ? '-y' : '-n',
    '-i',
    resolvedInputPath,
    '-vn',
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
  ];

  if (targetFormat === 'pcmf32') {
    ffmpegArgs.push('-f', 'f32le', '-acodec', 'pcm_f32le');
  } else if (targetFormat === 'wav') {
    ffmpegArgs.push('-c:a', 'pcm_s16le');
  }

  ffmpegArgs.push(resolvedOutputPath);

  try {
    execFileSync(ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const { raw, detail } = formatFfmpegStderr(err);
    if (/does not contain any stream|matches no streams/i.test(raw)) {
      throw new Error(
        `Failed to convert "${resolvedInputPath}" to ${targetFormat}: no audio stream found (${detail}). Hint: The source file appears to be a video or container without an audio track.`,
      );
    }

    throw new Error(
      `Failed to convert "${resolvedInputPath}" to ${targetFormat}: ${detail}. Hint: Verify that the source file is a valid audio or video file and try converting with format 'wav' (16kHz mono).`,
    );
  }

  return resolvedOutputPath;
}
