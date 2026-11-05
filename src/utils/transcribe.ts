import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type {
  SaveTranscriptionOptions,
  TranscribeOptions,
  TranscriptionMediaResult,
  TranscriptionSegment,
  WhisperFactory,
} from "../types/whisper-types.js";
import {
  SAMPLE_RATE,
  decodeAudioToFloat32,
  getFileType,
  resolveMediaFile,
} from "./audio.js";

const require = createRequire(import.meta.url);

const DEFAULT_MODEL_NAME = "ggml-base.en.bin";
const DEFAULT_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}`;
const SEGMENT_REGEX =
  /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/;

const transcriptionCache = new Map<string, TranscriptionMediaResult>();

function parseTimestampToMs(timestamp: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(timestamp.trim());
  if (!match) return 0;
  return (
    (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
      1000 +
    Number(match[4])
  );
}

function formatMsToTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

async function resolveModelPath(
  customModelPath: string | undefined,
  baseDir: string,
): Promise<string> {
  const configured = customModelPath ?? process.env.WHISPER_MODEL_PATH;
  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.resolve(baseDir, configured);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Whisper model file not found at: ${resolved}. Hint: Omit 'modelPath' to automatically use the default model (${DEFAULT_MODEL_NAME}), or verify the path to your local whisper.cpp GGML .bin model file.`,
      );
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory() || stat.size === 0) {
      throw new Error(
        `Whisper model path is invalid (${stat.isDirectory() ? "is a directory" : "file is empty"}): ${resolved}. Hint: Provide a valid non-empty whisper.cpp GGML .bin model file or omit 'modelPath' to use the default model.`,
      );
    }
    return resolved;
  }

  const cacheDir = path.join(os.homedir(), ".cache", "whisper2opencode");
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

      const cleanWord = rawToken.replace(
        /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,
        "",
      );
      if (!cleanWord) continue;

      const tokenStart = match.index ?? 0;
      const tokenEnd = tokenStart + rawToken.length;
      const startRatio =
        seg.text.length > 0 ? tokenStart / seg.text.length : 0;
      const endRatio = seg.text.length > 0 ? tokenEnd / seg.text.length : 1;

      const startMs = Math.round(
        seg.startMs + startRatio * (seg.endMs - seg.startMs),
      );
      const endMs = Math.max(
        startMs,
        Math.round(seg.startMs + endRatio * (seg.endMs - seg.startMs)),
      );

      lines.push(
        `[${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(endMs)}] ${cleanWord}`,
      );
    }
  }

  return lines;
}

export async function transcribeAudioFile(
  options: TranscribeOptions,
): Promise<string> {
  const baseDir = options.directory ?? process.cwd();
  const { resolvedPath: resolvedInputPath, stat } = resolveMediaFile(
    options.filePath,
    baseDir,
    "filePath",
  );
  const resolvedModelPath = await resolveModelPath(options.modelPath, baseDir);
  const language = options.language?.trim() || "en";
  const cacheKey = `${resolvedInputPath}:${stat.mtimeMs}:${stat.size}:${language}:${resolvedModelPath}`;

  let result = transcriptionCache.get(cacheKey);
  if (!result) {
    const modelData = fs.readFileSync(resolvedModelPath);
    const pcm = decodeAudioToFloat32(resolvedInputPath);
    const durationMs = Math.round((pcm.length / SAMPLE_RATE) * 1000);

    const whisperFactory = require("whisper.cpp") as WhisperFactory;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const whisper = await whisperFactory({
      print: (text: string) => stdoutLines.push(text),
      printErr: (text: string) => stderrLines.push(text),
    });

    try {
      whisper.FS_createDataFile("/", "whisper.bin", modelData, true, true);
      if (!whisper.init("whisper.bin")) {
        throw new Error(
          `whisper.cpp failed to initialize model from "${resolvedModelPath}". Hint: Ensure the model is a valid whisper.cpp GGML .bin file (not PyTorch/ONNX/Safetensors). If using the cached default model, delete "${resolvedModelPath}" and retry so it re-downloads.`,
        );
      }

      const code = whisper.full_default(pcm, language, false);
      if (code !== 0) {
        const errDetail = stderrLines.slice(-3).join(" | ");
        throw new Error(
          `whisper.cpp transcription failed with code ${code}${errDetail ? ` (${errDetail})` : ""}. Hint: Check that 'language' ("${language}") is a valid ISO 639-1 code (e.g. 'en', 'pl', 'de', 'es'). For non-English audio, provide a multilingual GGML model (e.g. ggml-base.bin) via 'modelPath'.`,
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

  return wordLines.length > 0
    ? `${headerLines.join("\n")}\n\n${wordLines.join("\n")}`
    : headerLines.join("\n");
}

export function saveTranscriptionFile(
  options: SaveTranscriptionOptions,
): string {
  const baseDir = path.resolve(options.directory ?? process.cwd());
  const rawFilePath = options.filePath?.trim();
  if (!rawFilePath) {
    throw new Error(
      "Missing required 'filePath' argument. Hint: Provide a relative '.txt' file path inside the working directory (e.g. 'transcription.txt').",
    );
  }

  if (typeof options.content !== "string" || !options.content.trim()) {
    throw new Error(
      "Missing or empty 'content' argument. Hint: Provide the non-empty transcription text to save.",
    );
  }

  const candidatePath = path.isAbsolute(rawFilePath)
    ? path.resolve(rawFilePath)
    : path.resolve(baseDir, rawFilePath);

  const relativeToBase = path.relative(baseDir, candidatePath);
  if (
    !relativeToBase ||
    relativeToBase.startsWith("..") ||
    path.isAbsolute(relativeToBase)
  ) {
    throw new Error(
      `Output path "${candidatePath}" is outside the working directory "${baseDir}". Hint: Provide a relative '.txt' file path inside the current working directory without '..' traversal.`,
    );
  }

  const segments = relativeToBase.split(path.sep);
  if (segments.some((seg) => seg.startsWith("."))) {
    throw new Error(
      `Output path "${candidatePath}" cannot target hidden files or directories. Hint: Provide a standard '.txt' filename inside the working directory.`,
    );
  }

  const ext = path.extname(candidatePath);
  let resolvedOutputPath: string;
  if (ext === "") {
    resolvedOutputPath = `${candidatePath}.txt`;
  } else if (ext.toLowerCase() !== ".txt") {
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

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, options.content, {
    encoding: "utf8",
    flag: "wx",
  });

  return resolvedOutputPath;
}

