import path from 'node:path';
import type { TranscriptionSegment } from '../types/whisper-types.js';

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const TIMESTAMP_PAD_LENGTH = 2;
const MILLIS_PAD_LENGTH = 3;

// Matches whisper.cpp stdout segment lines containing start/end timestamps and transcribed text.
export const SEGMENT_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.*)$/;

// Matches a single timestamped word entry in transcription body content.
export const TIMESTAMPED_WORD_LINE_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (\S+)$/;

// Matches the leading YAML frontmatter metadata block delimited by `---` in transcription text files.
export const TRANSCRIPTION_METADATA_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n*/;

const SOURCE_FILE_PREFIXES = ['source_file:', 'sourcefile:', 'source file:', 'filename:', 'file:'] as const;
const DURATION_PREFIXES = ['duration:'] as const;

export function parseTimestampToMs(timestamp: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(timestamp.trim());
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    return 0;
  }
  const hours = Number(match[1]) * SECONDS_PER_HOUR;
  const minutes = Number(match[2]) * SECONDS_PER_MINUTE;
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return (hours + minutes + seconds) * MILLISECONDS_PER_SECOND + millis;
}

export function formatMsToTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / MILLISECONDS_PER_HOUR);
  const minutes = Math.floor((clamped % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE);
  const seconds = Math.floor((clamped % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND);
  const millis = clamped % MILLISECONDS_PER_SECOND;
  const hoursString = String(hours).padStart(TIMESTAMP_PAD_LENGTH, '0');
  const minutesString = String(minutes).padStart(TIMESTAMP_PAD_LENGTH, '0');
  const secondsString = String(seconds).padStart(TIMESTAMP_PAD_LENGTH, '0');
  const millisString = String(millis).padStart(MILLIS_PAD_LENGTH, '0');
  return `${hoursString}:${minutesString}:${secondsString}.${millisString}`;
}

const isLetterOrDigit = (character: string): boolean => /\p{L}|\p{N}/u.test(character);

const cleanTokenWord = (rawToken: string): string => {
  let startIndex = 0;
  while (startIndex < rawToken.length && !isLetterOrDigit(rawToken.charAt(startIndex))) {
    startIndex++;
  }
  let endIndex = rawToken.length;
  while (endIndex > startIndex && !isLetterOrDigit(rawToken.charAt(endIndex - 1))) {
    endIndex--;
  }
  return rawToken.slice(startIndex, endIndex);
};

export function formatWordLines(segments: TranscriptionSegment[]): string[] {
  const lines: string[] = [];
  const tokenRegex = /\S+/g;

  for (const segment of segments) {
    for (const match of segment.text.matchAll(tokenRegex)) {
      const rawToken = match[0];
      if (/^\[.*\]$/.test(rawToken)) {
        continue;
      }

      const cleanWord = cleanTokenWord(rawToken);
      if (!cleanWord) {
        continue;
      }

      const tokenStart = match.index ?? 0;
      const tokenEnd = tokenStart + rawToken.length;
      const startRatio = segment.text.length > 0 ? tokenStart / segment.text.length : 0;
      const endRatio = segment.text.length > 0 ? tokenEnd / segment.text.length : 1;

      const duration = segment.endMs - segment.startMs;
      const startMs = Math.round(segment.startMs + startRatio * duration);
      const endMs = Math.max(startMs, Math.round(segment.startMs + endRatio * duration));

      lines.push(`[${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(endMs)}] ${cleanWord}`);
    }
  }

  return lines;
}

export function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  const isQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return isQuoted ? trimmed.slice(1, -1).trim() : trimmed;
}

const matchMetadataPrefix = (line: string, prefixes: readonly string[]): string | undefined => {
  const lowerLine = line.toLowerCase();
  for (const prefix of prefixes) {
    if (lowerLine.startsWith(prefix)) {
      return stripSurroundingQuotes(line.slice(prefix.length).trim());
    }
  }
  return undefined;
};

const parseMetadataBlock = (metadataBlock: string): { sourceFile?: string; duration?: string } => {
  let sourceFile: string | undefined;
  let duration: string | undefined;

  for (const rawLine of metadataBlock.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fileCandidate = matchMetadataPrefix(line, SOURCE_FILE_PREFIXES);
    if (fileCandidate !== undefined) {
      sourceFile = fileCandidate;
      continue;
    }
    const durationCandidate = matchMetadataPrefix(line, DURATION_PREFIXES);
    if (durationCandidate !== undefined) {
      duration = durationCandidate;
    }
  }

  return { sourceFile, duration };
};

const extractRawHeaderMetadata = (trimmed: string): { sourceFile?: string; duration?: string; body: string } | undefined => {
  const lines = trimmed.split(/\r?\n/);
  let sourceFile: string | undefined;
  let duration: string | undefined;
  let headerEndIndex = -1;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '') {
      headerEndIndex = index;
      break;
    }
    const fileCandidate = matchMetadataPrefix(line, SOURCE_FILE_PREFIXES);
    if (fileCandidate !== undefined) {
      sourceFile = fileCandidate;
      continue;
    }
    const durationCandidate = matchMetadataPrefix(line, DURATION_PREFIXES);
    if (durationCandidate !== undefined) {
      duration = durationCandidate;
    }
  }

  if (sourceFile && duration && headerEndIndex !== -1) {
    const body = lines.slice(headerEndIndex).join('\n').trim();
    return { sourceFile, duration, body };
  }
  return undefined;
};

export function extractMetadataAndBody(rawContent: string): {
  sourceFile?: string;
  duration?: string;
  body: string;
} {
  const trimmed = rawContent.trim();
  const frontmatterMatch = TRANSCRIPTION_METADATA_REGEX.exec(trimmed);
  if (frontmatterMatch) {
    const metadataBlock = frontmatterMatch[1] ?? '';
    const body = trimmed.slice(frontmatterMatch[0].length).trim();
    const parsed = parseMetadataBlock(metadataBlock);
    return { ...parsed, body };
  }

  return extractRawHeaderMetadata(trimmed) ?? { body: trimmed };
}

export function stripTranscriptionMetadata(content: string): string {
  return content.replace(TRANSCRIPTION_METADATA_REGEX, '');
}

const validateWordLine = (line: string, lineIndex: number): string => {
  const match = TIMESTAMPED_WORD_LINE_REGEX.exec(line);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `Invalid transcription body format at line ${lineIndex + 1}: "${line}". Saved transcriptions must be a sequence of timestamped words with one "[HH:MM:SS.mmm --> HH:MM:SS.mmm] word" entry per row. Hint: Pass the exact "[HH:MM:SS.mmm --> HH:MM:SS.mmm] word" lines from the 'transcribe' tool output instead of reconstructed sentences or plain prose.`,
    );
  }
  return `[${match[1]} --> ${match[2]}] ${match[3]}`;
};

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

  const normalizedWordLines = rawLines.map((line, index) => validateWordLine(line, index));
  const resolvedSourceFile = path.basename(rawSourceFile);
  return `---\nsource_file: ${resolvedSourceFile}\nduration: ${resolvedDuration}\n---\n\n${normalizedWordLines.join('\n')}`;
}
