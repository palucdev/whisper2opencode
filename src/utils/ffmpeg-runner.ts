import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ConvertAudioOptions, SupportedConvertFormat } from '../types/whisper-types.js';
import { DEFAULT_AUDIO_SAMPLE_RATE, MAX_FFMPEG_BUFFER_SIZE, TAIL_ERROR_LINE_COUNT, VIDEO_EXTENSIONS } from './audio-constants.js';
import { getEnvironmentConfig } from './environment-config.js';

const require = createRequire(import.meta.url);

const extractFfmpegString = (rawCandidate: unknown): string | undefined => {
  if (typeof rawCandidate === 'string' && rawCandidate.trim().length > 0) {
    return rawCandidate.trim();
  }
  if (
    rawCandidate &&
    typeof rawCandidate === 'object' &&
    'default' in rawCandidate &&
    typeof (rawCandidate as { default: unknown }).default === 'string'
  ) {
    const defaultExport = (rawCandidate as { default: string }).default.trim();
    if (defaultExport.length > 0) {
      return defaultExport;
    }
  }
  return undefined;
};

const resolveFfmpegCandidate = (overridePath: unknown, moduleLoader: (identifier: string) => unknown): unknown => {
  if (overridePath !== undefined) {
    return overridePath;
  }
  const environmentPath = getEnvironmentConfig().ffmpegPath;
  if (environmentPath !== undefined) {
    return environmentPath;
  }
  try {
    return moduleLoader('ffmpeg-static');
  } catch {
    return undefined;
  }
};

const FFMPEG_MISSING_MESSAGE =
  "'ffmpeg' is required to extract and decode audio from media files, but was not found.\n\n" +
  'Hint: Install ffmpeg in your environment using your package manager:\n' +
  '  - macOS: brew install ffmpeg\n' +
  '  - Ubuntu / Debian: sudo apt update && sudo apt install -y ffmpeg\n' +
  '  - Fedora: sudo dnf install -y ffmpeg\n' +
  '  - Arch Linux: sudo pacman -S ffmpeg\n' +
  '  - Windows: winget install Gyan.FFmpeg (or choco install ffmpeg)\n\n' +
  'Or set the FFMPEG_PATH environment variable:\n' +
  '  export FFMPEG_PATH="/path/to/ffmpeg"\n\n' +
  "Alternative: Convert the media externally to 16kHz mono 32-bit float PCM (.pcmf32) and pass the .pcmf32 file to 'transcribe'.";

export function getFfmpegBinary(overridePath?: unknown, moduleLoader: (identifier: string) => unknown = require): string {
  const candidate = resolveFfmpegCandidate(overridePath, moduleLoader);
  const ffmpegPath = extractFfmpegString(candidate);
  if (!ffmpegPath) {
    throw new Error(FFMPEG_MISSING_MESSAGE);
  }
  return ffmpegPath;
}

const extractStderrString = (error: unknown): string => {
  if (error && typeof error === 'object' && 'stderr' in error && Buffer.isBuffer(error.stderr)) {
    return error.stderr.toString('utf8').trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export function formatFfmpegStderr(error: unknown): { raw: string; detail: string } {
  const raw = extractStderrString(error);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const detail = lines.slice(-TAIL_ERROR_LINE_COUNT).join(' | ') || 'unknown ffmpeg error';
  return { raw, detail };
}

const handleDecodeFfmpegError = (error: unknown, mediaPath: string): never => {
  const { raw, detail } = formatFfmpegStderr(error);
  const isVideo = VIDEO_EXTENSIONS.has(mediaPath.slice(mediaPath.lastIndexOf('.')).toLowerCase());
  const action = isVideo ? `Failed to isolate audio from video "${mediaPath}"` : `Failed to decode audio from "${mediaPath}"`;

  if (/does not contain any stream|matches no streams/i.test(raw)) {
    throw new Error(
      `${action}: no audio stream found (${detail}). Hint: Verify that the media file contains an audio stream before attempting transcription.`,
      { cause: error },
    );
  }

  if (/Invalid data found when processing input|Format .* detected only with low score|moov atom not found/i.test(raw)) {
    throw new Error(
      `${action}: invalid or corrupted media format (${detail}). Hint: Verify that the file is a valid audio/video recording or convert it to a 16kHz mono .wav file first.`,
      { cause: error },
    );
  }

  throw new Error(
    `${action}: ${detail}. Hint: Ensure the file is a valid audio or video file (.wav, .mp3, .m4a, .ogg, .flac, .webm, .mp4, .mkv, .mov, .pcmf32) or convert it to .wav before retrying.`,
    { cause: error },
  );
};

export function runFfmpegDecode(ffmpegPath: string, mediaPath: string): Buffer {
  try {
    return execFileSync(
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
        String(DEFAULT_AUDIO_SAMPLE_RATE),
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
        maxBuffer: MAX_FFMPEG_BUFFER_SIZE,
      },
    );
  } catch (error) {
    return handleDecodeFfmpegError(error, mediaPath);
  }
}

export function buildConvertArguments(options: ConvertAudioOptions, paths: { resolvedInputPath: string; resolvedOutputPath: string }): string[] {
  const targetFormat = options.format ?? 'wav';
  const sampleRate = options.sampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const isOverwrite = options.isOverwrite ?? options.overwrite ?? true;

  const commandArguments = [
    '-hide_banner',
    '-loglevel',
    'error',
    isOverwrite ? '-y' : '-n',
    '-i',
    paths.resolvedInputPath,
    '-vn',
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
  ];

  if (targetFormat === 'pcmf32') {
    commandArguments.push('-f', 'f32le', '-acodec', 'pcm_f32le');
  } else if (targetFormat === 'wav') {
    commandArguments.push('-c:a', 'pcm_s16le');
  }

  commandArguments.push(paths.resolvedOutputPath);
  return commandArguments;
}

export function handleConvertError(error: unknown, context: { resolvedInputPath: string; targetFormat: SupportedConvertFormat }): never {
  const { raw, detail } = formatFfmpegStderr(error);
  if (/does not contain any stream|matches no streams/i.test(raw)) {
    throw new Error(
      `Failed to convert "${context.resolvedInputPath}" to ${context.targetFormat}: no audio stream found (${detail}). Hint: The source file appears to be a video or container without an audio track.`,
      { cause: error },
    );
  }
  throw new Error(
    `Failed to convert "${context.resolvedInputPath}" to ${context.targetFormat}: ${detail}. Hint: Verify that the source file is a valid audio or video file and try converting with format 'wav' (16kHz mono).`,
    { cause: error },
  );
}
