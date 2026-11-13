import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type {
  SaveTranscriptionOptions,
  TranscribeOptions,
  TranscriptionMediaResult,
  TranscriptionSegment,
  WhisperFactory,
} from '../types/whisper-types.js';
import { SAMPLE_RATE, decodeAudioToFloat32, getFileType, resolveMediaFile } from './audio.js';

const require = createRequire(import.meta.url);

const DEFAULT_MODEL_NAME = 'ggml-base.en.bin';
const DEFAULT_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}`;

/**
 * Matches whisper.cpp stdout segment lines containing start/end timestamps and transcribed text.
 *
 * Example:
 *   "[00:00:00.000 --> 00:00:05.120] And so my fellow Americans"
 *
 * Captures:
 *   - match[1]: Start timestamp ("00:00:00.000")
 *   - match[2]: End timestamp ("00:00:05.120")
 *   - match[3]: Transcribed segment text ("And so my fellow Americans")
 */
const SEGMENT_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/;

/**
 * Matches a single timestamped word entry in transcription body content.
 *
 * Example:
 *   "[00:00:00.000 --> 00:00:00.120] And"
 *
 * Captures:
 *   - match[1]: Start timestamp ("00:00:00.000")
 *   - match[2]: End timestamp ("00:00:00.120")
 *   - match[3]: Non-whitespace word token ("And")
 */
export const TIMESTAMPED_WORD_LINE_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s+(\S+)$/;

/**
 * Matches the leading YAML frontmatter metadata block delimited by `---` in transcription text files.
 *
 * Example:
 *   ---
 *   source_file: interview.wav
 *   duration: 00:01:23.456 (83.46s)
 *   ---
 *
 * Captures:
 *   - match[1]: YAML metadata content block ("source_file: interview.wav\nduration: 00:01:23.456 (83.46s)")
 */
export const TRANSCRIPTION_METADATA_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n*/;

/**
 * Matches raw plain-text metadata headers produced by the transcribe tool or legacy formats.
 *
 * Example:
 *   Filename: interview.wav
 *   File type: audio/wav
 *   Duration: 00:01:23.456 (83.46s)
 *
 * Captures:
 *   - match[1]: Source filename ("interview.wav")
 *   - match[2]: Duration string ("00:01:23.456 (83.46s)")
 */
const RAW_METADATA_HEADER_REGEX =
  /^(?:Filename|Source file|source_file):\s*(.+)\r?\n(?:File type:\s*.+\r?\n)?(?:Duration|duration):\s*(.+)(?:\r?\n)+/i;

const transcriptionCache = new Map<string, TranscriptionMediaResult>();

function parseTimestampToMs(timestamp: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(timestamp.trim());
  if (!match) return 0;
  return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}

function formatMsToTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

async function resolveModelPath(customModelPath: string | undefined, baseDir: string): Promise<string> {
  const configured = customModelPath ?? process.env.WHISPER_MODEL_PATH;
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(baseDir, configured);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Whisper model file not found at: ${resolved}. Hint: Omit 'modelPath' to automatically use the default model (${DEFAULT_MODEL_NAME}), or verify the path to your local whisper.cpp GGML .bin model file.`,
      );
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory() || stat.size === 0) {
      throw new Error(
        `Whisper model path is invalid (${stat.isDirectory() ? 'is a directory' : 'file is empty'}): ${resolved}. Hint: Provide a valid non-empty whisper.cpp GGML .bin model file or omit 'modelPath' to use the default model.`,
      );
    }
    return resolved;
  }

  const cacheDir = path.join(os.homedir(), '.cache', 'whisper2opencode');
  const cachedModelPath = path.join(cacheDir, DEFAULT_MODEL_NAME);
  if (fs.existsSync(cachedModelPath)) {
    return cachedModelPath;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  let response: Response;
  try {
    response = await fetch(DEFAULT_MODEL_URL);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to download default model from ${DEFAULT_MODEL_URL} (${detail}). Hint: Check internet connectivity, or provide a local GGML .bin model file via 'modelPath' or the WHISPER_MODEL_PATH environment variable.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download default model (${response.status} ${response.statusText}). Hint: Check internet connectivity, or provide a local GGML .bin model file via 'modelPath' or the WHISPER_MODEL_PATH environment variable.`,
    );
  }

  const tmpPath = `${cachedModelPath}.tmp-${process.pid}`;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, cachedModelPath);
  return cachedModelPath;
}

function formatWordLines(segments: TranscriptionSegment[]): string[] {
  const lines: string[] = [];
  const tokenRegex = /\S+/g;

  for (const seg of segments) {
    for (const match of seg.text.matchAll(tokenRegex)) {
      const rawToken = match[0];
      if (/^\[.*\]$/.test(rawToken)) continue;

      const cleanWord = rawToken.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!cleanWord) continue;

      const tokenStart = match.index ?? 0;
      const tokenEnd = tokenStart + rawToken.length;
      const startRatio = seg.text.length > 0 ? tokenStart / seg.text.length : 0;
      const endRatio = seg.text.length > 0 ? tokenEnd / seg.text.length : 1;

      const startMs = Math.round(seg.startMs + startRatio * (seg.endMs - seg.startMs));
      const endMs = Math.max(startMs, Math.round(seg.startMs + endRatio * (seg.endMs - seg.startMs)));

      lines.push(`[${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(endMs)}] ${cleanWord}`);
    }
  }

  return lines;
}

export async function transcribeAudioFile(options: TranscribeOptions): Promise<string> {
  const baseDir = options.directory ?? process.cwd();
  const { resolvedPath: resolvedInputPath, stat } = resolveMediaFile(options.filePath, baseDir, 'filePath');
  const resolvedModelPath = await resolveModelPath(options.modelPath, baseDir);
  const language = options.language?.trim() || 'en';
  const cacheKey = `${resolvedInputPath}:${stat.mtimeMs}:${stat.size}:${language}:${resolvedModelPath}`;

  let result = transcriptionCache.get(cacheKey);
  if (!result) {
    const modelData = fs.readFileSync(resolvedModelPath);
    const pcm = decodeAudioToFloat32(resolvedInputPath);
    const durationMs = Math.round((pcm.length / SAMPLE_RATE) * 1000);

    const whisperFactory = require('whisper.cpp') as WhisperFactory;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const whisper = await whisperFactory({
      print: (text: string) => stdoutLines.push(text),
      printErr: (text: string) => stderrLines.push(text),
    });

    try {
      whisper.FS_createDataFile('/', 'whisper.bin', modelData, true, true);
      if (!whisper.init('whisper.bin')) {
        throw new Error(
          `whisper.cpp failed to initialize model from "${resolvedModelPath}". Hint: Ensure the model is a valid whisper.cpp GGML .bin file (not PyTorch/ONNX/Safetensors). If using the cached default model, delete "${resolvedModelPath}" and retry so it re-downloads.`,
        );
      }

      const code = whisper.full_default(pcm, language, false);
      if (code !== 0) {
        const errDetail = stderrLines.slice(-3).join(' | ');
        throw new Error(
          `whisper.cpp transcription failed with code ${code}${errDetail ? ` (${errDetail})` : ''}. Hint: Check that 'language' ("${language}") is a valid ISO 639-1 code (e.g. 'en', 'pl', 'de', 'es'). For non-English audio, provide a multilingual GGML model (e.g. ggml-base.bin) via 'modelPath'.`,
        );
      }
    } finally {
      whisper.free();
      whisper.PThread?.terminateAllThreads();
    }

    const segments: TranscriptionSegment[] = [];
    for (const line of stdoutLines) {
      const match = SEGMENT_REGEX.exec(line.trim());
      if (match?.[1] && match[2] && match[3]) {
        const text = match[3].trim();
        if (text.length > 0) {
          segments.push({
            startMs: parseTimestampToMs(match[1]),
            endMs: parseTimestampToMs(match[2]),
            text,
          });
        }
      }
    }

    result = { segments, durationMs };
    transcriptionCache.set(cacheKey, result);
  }

  const clampedDurationMs = Math.max(0, Math.round(result.durationMs));
  const headerLines = [
    `Filename: ${path.basename(resolvedInputPath)}`,
    `File type: ${getFileType(resolvedInputPath)}`,
    `Duration: ${formatMsToTimestamp(clampedDurationMs)} (${(clampedDurationMs / 1000).toFixed(2)}s)`,
  ];
  const wordLines = formatWordLines(result.segments);

  return wordLines.length > 0 ? `${headerLines.join('\n')}\n\n${wordLines.join('\n')}` : headerLines.join('\n');
}

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractMetadataAndBody(rawContent: string): {
  sourceFile?: string;
  duration?: string;
  body: string;
} {
  const trimmed = rawContent.trim();
  const frontmatterMatch = TRANSCRIPTION_METADATA_REGEX.exec(trimmed);
  if (frontmatterMatch) {
    const metadataBlock = frontmatterMatch[1] ?? '';
    const body = trimmed.slice(frontmatterMatch[0].length).trim();
    let sourceFile: string | undefined;
    let duration: string | undefined;

    for (const line of metadataBlock.split(/\r?\n/)) {
      const sourceMatch = /^(?:source_file|sourceFile|source file|filename|file):\s*(.+)$/i.exec(line.trim());
      if (sourceMatch?.[1]) {
        sourceFile = stripSurroundingQuotes(sourceMatch[1]);
        continue;
      }
      const durationMatch = /^duration:\s*(.+)$/i.exec(line.trim());
      if (durationMatch?.[1]) {
        duration = stripSurroundingQuotes(durationMatch[1]);
      }
    }

    return { sourceFile, duration, body };
  }

  const rawHeaderMatch = RAW_METADATA_HEADER_REGEX.exec(trimmed);
  if (rawHeaderMatch?.[1] && rawHeaderMatch[2]) {
    const sourceFile = stripSurroundingQuotes(rawHeaderMatch[1]);
    const duration = stripSurroundingQuotes(rawHeaderMatch[2]);
    const body = trimmed.slice(rawHeaderMatch[0].length).trim();
    return { sourceFile, duration, body };
  }

  return { body: trimmed };
}

export function stripTranscriptionMetadata(content: string): string {
  return content.replace(TRANSCRIPTION_METADATA_REGEX, '');
}

export function formatTranscriptionWithMetadata(options: { content: string; sourceFile?: string; duration?: string }): string {
  const extracted = extractMetadataAndBody(options.content);
  const rawLines = extracted.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    throw new Error(
      "Missing or empty transcription body in 'content'. Hint: Provide non-empty timestamped word lines in addition to the metadata header.",
    );
  }

  const rawSourceFile = options.sourceFile?.trim() || extracted.sourceFile?.trim();
  if (!rawSourceFile) {
    throw new Error(
      "Missing required source file metadata ('sourceFile'). Hint: Provide 'sourceFile' (e.g. 'jfk.wav') or include 'source_file: <filename>' in a leading --- metadata --- block.",
    );
  }

  const resolvedDuration = options.duration?.trim() || extracted.duration?.trim();
  if (!resolvedDuration) {
    throw new Error(
      "Missing required audio/video duration metadata ('duration'). Hint: Provide 'duration' (e.g. '00:00:11.000 (11.00s)') or include 'duration: <duration>' in a leading --- metadata --- block.",
    );
  }

  const normalizedWordLines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    const match = TIMESTAMPED_WORD_LINE_REGEX.exec(line);
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error(
        `Invalid transcription body format at line ${i + 1}: "${line}". Saved transcriptions must be a sequence of timestamped words with one "[HH:MM:SS.mmm --> HH:MM:SS.mmm] word" entry per row. Hint: Pass the exact "[HH:MM:SS.mmm --> HH:MM:SS.mmm] word" lines from the 'transcribe' tool output instead of reconstructed sentences or plain prose.`,
      );
    }
    normalizedWordLines.push(`[${match[1]} --> ${match[2]}] ${match[3]}`);
  }

  const resolvedSourceFile = path.basename(rawSourceFile);
  return `---\nsource_file: ${resolvedSourceFile}\nduration: ${resolvedDuration}\n---\n\n${normalizedWordLines.join('\n')}`;
}

export function saveTranscriptionFile(options: SaveTranscriptionOptions): string {
  const baseDir = path.resolve(options.directory ?? process.cwd());
  const rawFilePath = options.filePath?.trim();
  if (!rawFilePath) {
    throw new Error(
      "Missing required 'filePath' argument. Hint: Provide a relative '.txt' file path inside the working directory (e.g. 'transcription.txt').",
    );
  }

  if (typeof options.content !== 'string' || !options.content.trim()) {
    throw new Error("Missing or empty 'content' argument. Hint: Provide the non-empty transcription text to save.");
  }

  const candidatePath = path.isAbsolute(rawFilePath) ? path.resolve(rawFilePath) : path.resolve(baseDir, rawFilePath);

  const relativeToBase = path.relative(baseDir, candidatePath);
  if (!relativeToBase || relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    throw new Error(
      `Output path "${candidatePath}" is outside the working directory "${baseDir}". Hint: Provide a relative '.txt' file path inside the current working directory without '..' traversal.`,
    );
  }

  const segments = relativeToBase.split(/[/\\]/);
  if (segments.some((seg) => seg.startsWith('.'))) {
    throw new Error(
      `Output path "${candidatePath}" cannot target hidden files or directories. Hint: Provide a standard '.txt' filename inside the working directory.`,
    );
  }

  const ext = path.extname(candidatePath);
  let resolvedOutputPath: string;
  if (ext === '') {
    resolvedOutputPath = `${candidatePath}.txt`;
  } else if (ext.toLowerCase() !== '.txt') {
    throw new Error(
      `Invalid transcription file extension "${ext}" for "${candidatePath}". Only ".txt" transcription files are allowed. Hint: Use a ".txt" file extension (e.g. "${path.basename(candidatePath, ext)}.txt").`,
    );
  } else {
    resolvedOutputPath = candidatePath;
  }

  if (fs.existsSync(resolvedOutputPath)) {
    throw new Error(
      `Transcription file already exists: ${resolvedOutputPath}. Existing files cannot be modified or overwritten. Hint: Choose a new, non-existent '.txt' filename within the working directory.`,
    );
  }

  const formattedContent = formatTranscriptionWithMetadata({
    content: options.content,
    sourceFile: options.sourceFile,
    duration: options.duration,
  });

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, formattedContent, {
    encoding: 'utf8',
    flag: 'wx',
  });

  return resolvedOutputPath;
}
