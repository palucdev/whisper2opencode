import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"

const require = createRequire(import.meta.url)

type WhisperInstance = {
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ): void
  init(pathModel: string): boolean
  full_default(audio: Float32Array, lang: string, translate: boolean): number
  free(): void
  PThread?: {
    terminateAllThreads(): void
  }
}

type WhisperFactory = (moduleOverrides?: {
  print?: (text: string) => void
  printErr?: (text: string) => void
}) => Promise<WhisperInstance>

const DEFAULT_MODEL_NAME = "ggml-base.en.bin"
const DEFAULT_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}`
const SEGMENT_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/

async function resolveModelPath(customModelPath: string | undefined, baseDir: string): Promise<string> {
  const configured = customModelPath ?? process.env.WHISPER_MODEL_PATH
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(baseDir, configured)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Whisper model file not found at: ${resolved}`)
    }
    return resolved
  }

  const cacheDir = path.join(os.homedir(), ".cache", "whisper2opencode")
  const cachedModelPath = path.join(cacheDir, DEFAULT_MODEL_NAME)
  if (fs.existsSync(cachedModelPath)) {
    return cachedModelPath
  }

  fs.mkdirSync(cacheDir, { recursive: true })
  const response = await fetch(DEFAULT_MODEL_URL)
  if (!response.ok) {
    throw new Error(`Failed to download default model (${response.status} ${response.statusText})`)
  }

  const tmpPath = `${cachedModelPath}.tmp-${process.pid}`
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(tmpPath, buffer)
  fs.renameSync(tmpPath, cachedModelPath)
  return cachedModelPath
}

function decodeAudioToFloat32(audioPath: string): Float32Array {
  if (audioPath.endsWith(".pcmf32")) {
    const raw = fs.readFileSync(audioPath)
    return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
  }

  const ffmpegPath = require("ffmpeg-static") as string | null
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary is not available for this platform")
  }

  const pcmBuffer = execFileSync(
    ffmpegPath,
    ["-i", audioPath, "-ar", "16000", "-ac", "1", "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    },
  )

  return new Float32Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    Math.floor(pcmBuffer.byteLength / 4),
  )
}

async function transcribeAudioFile(options: {
  filePath: string
  language?: string
  modelPath?: string
  directory?: string
}): Promise<string> {
  const baseDir = options.directory ?? process.cwd()
  const resolvedAudioPath = path.isAbsolute(options.filePath)
    ? options.filePath
    : path.resolve(baseDir, options.filePath)

  if (!fs.existsSync(resolvedAudioPath)) {
    throw new Error(`Audio file not found: ${resolvedAudioPath}`)
  }

  const resolvedModelPath = await resolveModelPath(options.modelPath, baseDir)
  const modelData = fs.readFileSync(resolvedModelPath)
  const pcm = decodeAudioToFloat32(resolvedAudioPath)

  const whisperFactory = require("whisper.cpp") as WhisperFactory
  const stdoutLines: string[] = []

  const whisper = await whisperFactory({
    print: (text: string) => {
      stdoutLines.push(text)
    },
    printErr: () => {},
  })

  try {
    whisper.FS_createDataFile("/", "whisper.bin", modelData, true, true)
    if (!whisper.init("whisper.bin")) {
      throw new Error("whisper.cpp failed to initialize model")
    }

    const code = whisper.full_default(pcm, options.language ?? "en", false)
    if (code !== 0) {
      throw new Error(`whisper.cpp transcription failed with code ${code}`)
    }
  } finally {
    whisper.free()
    whisper.PThread?.terminateAllThreads()
  }

  const segments: string[] = []
  for (const line of stdoutLines) {
    const match = SEGMENT_REGEX.exec(line.trim())
    if (match && match[3]) {
      segments.push(match[3].trim())
    }
  }

  return segments.join(" ").trim()
}

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling
const WhisperPlugin: Plugin = async () => {
  return {
    tool: {
      transcribe: tool({
        description:
          "Transcribe audio or voice files (.wav, .mp3, .m4a, .ogg, .flac, .webm, .pcmf32) to text using whisper.cpp. Always use this tool instead of read or bash when the user references an audio file.",
        args: {
          filePath: tool.schema.string().describe("Path to the audio file to transcribe"),
          language: tool.schema
            .string()
            .optional()
            .describe("Language code for transcription (default: 'en')"),
          modelPath: tool.schema
            .string()
            .optional()
            .describe("Optional path to a local whisper.cpp GGML .bin model file"),
        },
        async execute(args, context) {
          return transcribeAudioFile({
            filePath: args.filePath,
            language: args.language,
            modelPath: args.modelPath,
            directory: context.directory,
          })
        },
      }),
    },
  }
}

export default WhisperPlugin
