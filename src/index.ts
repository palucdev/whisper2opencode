import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, tool } from "@opencode-ai/plugin";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPluginVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version.length > 0
      ? version
      : "unknown";
  } catch {
    return "unknown";
  }
}

const PLUGIN_VERSION = readPluginVersion();

type WhisperInstance = {
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ): void;
  init(pathModel: string): boolean;
  full_default(audio: Float32Array, lang: string, translate: boolean): number;
  free(): void;
  PThread?: {
    terminateAllThreads(): void;
  };
};

type WhisperFactory = (moduleOverrides?: {
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<WhisperInstance>;

const DEFAULT_MODEL_NAME = "ggml-base.en.bin";
const DEFAULT_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}`;
const SEGMENT_REGEX =
  /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/;
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".webm",
  ".flv",
  ".m4v",
  ".ts",
  ".mts",
  ".m2ts",
  ".mpeg",
  ".mpg",
  ".3gp",
  ".wmv",
  ".ogv",
  ".vob",
]);

function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getFfmpegBinary(): string {
  const ffmpegPath = require("ffmpeg-static") as string | null;
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static binary is not available for this platform. Hint: Convert the input file to raw 16kHz mono 32-bit float PCM (.pcmf32) externally and pass the .pcmf32 file to 'transcribe'.",
    );
  }
  return ffmpegPath;
}

function formatFfmpegStderr(err: unknown): { raw: string; detail: string } {
  const raw =
    err && typeof err === "object" && "stderr" in err && Buffer.isBuffer(err.stderr)
      ? err.stderr.toString("utf8").trim()
      : err instanceof Error
        ? err.message
        : String(err);
  const detail =
    raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-3)
      .join(" | ") || "unknown ffmpeg error";
  return { raw, detail };
}

function isolateAudioFromVideo(videoPath: string): string {
  const ffmpegPath = getFfmpegBinary();
  const tempWavPath = path.join(
    os.tmpdir(),
    `whisper2opencode-isolated-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  try {
    execFileSync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        videoPath,
        "-vn",
        "-map",
        "0:a:0",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        tempWavPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    try {
      if (fs.existsSync(tempWavPath)) {
        fs.unlinkSync(tempWavPath);
      }
    } catch {
      // ignore cleanup error
    }

    const { raw, detail } = formatFfmpegStderr(err);
    if (/does not contain any stream|matches no streams/i.test(raw)) {
      throw new Error(
        `Failed to isolate audio from video "${videoPath}": no audio stream found (${detail}). Hint: This video file has no audio track (silent video). Verify that the video contains an audio stream before attempting transcription.`,
      );
    }

    if (/Invalid data found when processing input|Format .* detected only with low score|moov atom not found/i.test(raw)) {
      throw new Error(
        `Failed to isolate audio from video "${videoPath}": invalid or corrupted video container (${detail}). Hint: Verify that the video file is complete and not corrupted, or extract/convert its audio track to a 16kHz mono .wav file first.`,
      );
    }

    throw new Error(
      `Failed to isolate audio from video "${videoPath}": ${detail}. Hint: Ensure the video format is supported (.mp4, .mkv, .mov, .avi, .webm) and contains a valid audio track, or convert it to .wav first.`,
    );
  }

  return tempWavPath;
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

function decodeAudioToFloat32(audioPath: string): Float32Array {
  if (audioPath.endsWith(".pcmf32")) {
    const raw = fs.readFileSync(audioPath);
    const samples = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      Math.floor(raw.byteLength / 4),
    );
    if (samples.length === 0) {
      throw new Error(
        `Decoded audio from "${audioPath}" contains 0 samples. Hint: The .pcmf32 file is empty or smaller than 4 bytes. Regenerate the file as 16kHz mono 32-bit float PCM or pass the original audio/video file.`,
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
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        audioPath,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "pipe:1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  } catch (err) {
    const { raw: stderrRaw, detail } = formatFfmpegStderr(err);

    if (/does not contain any stream|matches no streams/i.test(stderrRaw)) {
      throw new Error(
        `Failed to decode audio from "${audioPath}": no audio stream found (${detail}). Hint: The file appears to be a video or container without an audio track. Verify the file contains audio before transcribing.`,
      );
    }

    if (/Invalid data found when processing input|Format .* detected only with low score|moov atom not found/i.test(stderrRaw)) {
      throw new Error(
        `Failed to decode audio from "${audioPath}": invalid or corrupted media format (${detail}). Hint: Verify that the file is an actual audio/video recording (not a text/HTML file or incomplete download), or convert it to a 16kHz mono .wav file first.`,
      );
    }

    throw new Error(
      `Failed to decode audio from "${audioPath}": ${detail}. Hint: Ensure the file is a valid audio or video file (.wav, .mp3, .m4a, .ogg, .flac, .webm, .mp4, .mkv, .mov, .pcmf32) or convert it to .wav before retrying.`,
    );
  }

  const samples = new Float32Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    Math.floor(pcmBuffer.byteLength / 4),
  );
  if (samples.length === 0) {
    throw new Error(
      `Decoded audio from "${audioPath}" contains 0 samples. Hint: The audio stream is empty or has zero duration. Check the source file or convert it to a valid 16kHz mono .wav file.`,
    );
  }
  return samples;
}

async function transcribeAudioFile(options: {
  filePath: string;
  language?: string;
  modelPath?: string;
  directory?: string;
}): Promise<string> {
  if (!options.filePath || !options.filePath.trim()) {
    throw new Error(
      "Missing required 'filePath' argument. Hint: Provide a valid path to an audio or video file (e.g. .wav, .mp3, .m4a, .ogg, .flac, .webm, .mp4, .mkv, .mov).",
    );
  }

  const baseDir = options.directory ?? process.cwd();
  const resolvedInputPath = path.isAbsolute(options.filePath)
    ? options.filePath
    : path.resolve(baseDir, options.filePath);

  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(
      `Audio/video file not found: ${resolvedInputPath}. Hint: Verify the file path using glob or list tools (resolved relative to "${baseDir}"), and pass an existing absolute path.`,
    );
  }

  const stat = fs.statSync(resolvedInputPath);
  if (stat.isDirectory()) {
    throw new Error(
      `Path is a directory, not an audio or video file: ${resolvedInputPath}. Hint: List the files inside "${resolvedInputPath}" first and pass the path to a specific audio or video file.`,
    );
  }
  if (stat.size === 0) {
    throw new Error(
      `Audio/video file is empty (0 bytes): ${resolvedInputPath}. Hint: Check that the file was properly written or downloaded before calling 'transcribe'.`,
    );
  }

  const resolvedModelPath = await resolveModelPath(options.modelPath, baseDir);
  const modelData = fs.readFileSync(resolvedModelPath);

  let isolatedAudioPath: string | undefined;
  let pcm: Float32Array;
  try {
    const audioSourcePath = isVideoFile(resolvedInputPath)
      ? (isolatedAudioPath = isolateAudioFromVideo(resolvedInputPath))
      : resolvedInputPath;
    pcm = decodeAudioToFloat32(audioSourcePath);
  } finally {
    if (isolatedAudioPath) {
      try {
        if (fs.existsSync(isolatedAudioPath)) {
          fs.unlinkSync(isolatedAudioPath);
        }
      } catch {
        // ignore cleanup error
      }
    }
  }

  const whisperFactory = require("whisper.cpp") as WhisperFactory;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const whisper = await whisperFactory({
    print: (text: string) => {
      stdoutLines.push(text);
    },
    printErr: (text: string) => {
      stderrLines.push(text);
    },
  });

  const language = options.language?.trim() || "en";

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

  const segments: string[] = [];
  for (const line of stdoutLines) {
    const match = SEGMENT_REGEX.exec(line.trim());
    if (match && match[3]) {
      segments.push(match[3].trim());
    }
  }

  return segments.join(" ").trim();
}

type SupportedConvertFormat = "wav" | "mp3" | "ogg" | "flac" | "m4a" | "pcmf32";

function convertAudioFile(options: {
  inputPath: string;
  outputPath?: string;
  format?: SupportedConvertFormat;
  sampleRate?: number;
  channels?: number;
  overwrite?: boolean;
  directory?: string;
}): string {
  if (!options.inputPath || !options.inputPath.trim()) {
    throw new Error(
      "Missing required 'inputPath' argument. Hint: Provide a path to an existing audio or video file to convert.",
    );
  }

  const baseDir = options.directory ?? process.cwd();
  const resolvedInputPath = path.isAbsolute(options.inputPath)
    ? options.inputPath
    : path.resolve(baseDir, options.inputPath);

  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(
      `Source media file not found: ${resolvedInputPath}. Hint: Verify 'inputPath' using glob or list tools (resolved relative to "${baseDir}").`,
    );
  }

  const stat = fs.statSync(resolvedInputPath);
  if (stat.isDirectory()) {
    throw new Error(
      `Source path is a directory, not a media file: ${resolvedInputPath}. Hint: List the directory contents and pass a specific audio or video file path.`,
    );
  }
  if (stat.size === 0) {
    throw new Error(
      `Source media file is empty (0 bytes): ${resolvedInputPath}. Hint: Check that the input file was properly created or downloaded before converting.`,
    );
  }

  const targetFormat: SupportedConvertFormat = options.format ?? "wav";
  const sampleRate = options.sampleRate ?? 16000;
  const channels = options.channels ?? 1;
  const overwrite = options.overwrite ?? true;

  let resolvedOutputPath: string;
  if (options.outputPath && options.outputPath.trim()) {
    resolvedOutputPath = path.isAbsolute(options.outputPath)
      ? options.outputPath
      : path.resolve(baseDir, options.outputPath);
  } else {
    const parsed = path.parse(resolvedInputPath);
    const candidate = path.join(parsed.dir, `${parsed.name}.${targetFormat}`);
    resolvedOutputPath =
      path.resolve(candidate) === path.resolve(resolvedInputPath)
        ? path.join(parsed.dir, `${parsed.name}.converted.${targetFormat}`)
        : candidate;
  }

  if (path.resolve(resolvedOutputPath) === path.resolve(resolvedInputPath)) {
    throw new Error(
      `Output path "${resolvedOutputPath}" cannot be the same as input path. Hint: Provide a distinct 'outputPath' or omit 'outputPath' so a separate converted file is created.`,
    );
  }

  if (!overwrite && fs.existsSync(resolvedOutputPath)) {
    throw new Error(
      `Output file already exists: ${resolvedOutputPath}. Hint: Set 'overwrite: true' or choose a different 'outputPath'.`,
    );
  }

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });

  const ffmpegPath = getFfmpegBinary();
  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    overwrite ? "-y" : "-n",
    "-i",
    resolvedInputPath,
    "-vn",
    "-ar",
    String(sampleRate),
    "-ac",
    String(channels),
  ];

  if (targetFormat === "pcmf32") {
    ffmpegArgs.push("-f", "f32le", "-acodec", "pcm_f32le");
  } else if (targetFormat === "wav") {
    ffmpegArgs.push("-c:a", "pcm_s16le");
  }

  ffmpegArgs.push(resolvedOutputPath);

  try {
    execFileSync(ffmpegPath, ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
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

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling
const WhisperPlugin: Plugin = async () => {
  return {
    tool: {
      transcribe: tool({
        description:
          "Transcribe audio, voice, or video files (.wav, .mp3, .m4a, .ogg, .flac, .webm, .mp4, .mkv, .mov, .avi, .pcmf32) to text using whisper.cpp. For video files, automatically isolates the audio track before transcription. Always use this tool instead of read or bash when the user references an audio or video file.",
        args: {
          filePath: tool.schema
            .string()
            .describe("Path to the audio or video file to transcribe"),
          language: tool.schema
            .string()
            .optional()
            .describe("Language code for transcription (default: 'en')"),
          modelPath: tool.schema
            .string()
            .optional()
            .describe(
              "Optional path to a local whisper.cpp GGML .bin model file",
            ),
        },
        async execute(args, context) {
          return transcribeAudioFile({
            filePath: args.filePath,
            language: args.language,
            modelPath: args.modelPath,
            directory: context.directory,
          });
        },
      }),
      convert_audio: tool({
        description:
          "Convert audio or video files to a target audio format (.wav, .mp3, .ogg, .flac, .m4a, .pcmf32) using ffmpeg. Useful for extracting audio tracks from video files, normalizing sample rate/channels (e.g. 16kHz mono for speech recognition), or repairing incompatible containers.",
        args: {
          inputPath: tool.schema
            .string()
            .describe("Path to the source audio or video file"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe(
              "Optional output file path. Defaults to the input filename with the target format extension in the same directory.",
            ),
          format: tool.schema
            .enum(["wav", "mp3", "ogg", "flac", "m4a", "pcmf32"])
            .optional()
            .describe("Target audio format (default: 'wav')"),
          sampleRate: tool.schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("Target sample rate in Hz (default: 16000)"),
          channels: tool.schema
            .number()
            .int()
            .min(1)
            .max(2)
            .optional()
            .describe(
              "Number of audio channels: 1 for mono, 2 for stereo (default: 1)",
            ),
          overwrite: tool.schema
            .boolean()
            .optional()
            .describe(
              "Whether to overwrite outputPath if it already exists (default: true)",
            ),
        },
        async execute(args, context) {
          return convertAudioFile({
            inputPath: args.inputPath,
            outputPath: args.outputPath,
            format: args.format,
            sampleRate: args.sampleRate,
            channels: args.channels,
            overwrite: args.overwrite,
            directory: context.directory,
          });
        },
      }),
    },
    config: async () => {
      console.log(
        `[whisper2opencode] Plugin installation completed successfully (v${PLUGIN_VERSION}).`,
      );
    },
  };
};

export default WhisperPlugin;
