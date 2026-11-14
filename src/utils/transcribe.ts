import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  LoadWhisperFactoryOptions,
  TranscribeOptions,
  TranscriptionMediaResult,
  TranscriptionSegment,
  WhisperFactory,
  WhisperInstance,
} from '../types/whisper-types.js';
import { SAMPLE_RATE, decodeAudioToFloat32, getFileType, resolveMediaFile } from './audio.js';
import { fileSystem } from './file-system.js';
import { resolveModelPath } from './model-resolver.js';
import { SEGMENT_REGEX, formatMsToTimestamp, formatWordLines, parseTimestampToMs } from './transcription-formatter.js';

export {
  TIMESTAMPED_WORD_LINE_REGEX,
  TRANSCRIPTION_METADATA_REGEX,
  formatTranscriptionWithMetadata,
  stripTranscriptionMetadata,
} from './transcription-formatter.js';

export { saveTranscriptionFile } from './transcription-saver.js';

const require = createRequire(import.meta.url);

const MILLISECONDS_PER_SECOND = 1000;
const DURATION_DECIMAL_PLACES = 2;
const TAIL_ERROR_LINES_COUNT = 3;

const transcriptionCache = new Map<string, TranscriptionMediaResult>();

const loadFactoryFromTarget = (targetDirectory?: string): WhisperFactory | undefined => {
  if (!targetDirectory) {
    return undefined;
  }
  try {
    const localRequire = createRequire(path.join(path.resolve(targetDirectory), 'noop.js'));
    const loaded = localRequire('whisper.cpp');
    return typeof loaded === 'function' ? (loaded as WhisperFactory) : undefined;
  } catch {
    return undefined;
  }
};

const resolveFactory = (options: LoadWhisperFactoryOptions, moduleLoader: (identifier: string) => unknown): WhisperFactory | undefined => {
  if (options.overrideFactory !== undefined) {
    return typeof options.overrideFactory === 'function' ? (options.overrideFactory as WhisperFactory) : undefined;
  }
  try {
    const loaded = moduleLoader('whisper.cpp');
    if (typeof loaded === 'function') {
      return loaded as WhisperFactory;
    }
  } catch {
    // Fall through to checking targetDirectory
  }
  return loadFactoryFromTarget(options.targetDirectory);
};

const WHISPER_PACKAGE_MISSING_MESSAGE =
  "Package 'whisper.cpp' is required for transcription, but was not found or could not be loaded in your environment.\n\n" +
  "Hint: Run the 'download_whisper_cpp' tool to automatically download and set up whisper.cpp and the default speech model for your current setup:\n" +
  '  - Tool call: download_whisper_cpp({})\n\n' +
  'Or manually install whisper.cpp in your plugin or project directory:\n' +
  '   - Bun: bun add whisper.cpp\n' +
  '   - Node: npm install whisper.cpp\n\n' +
  '2. Download a GGML model file (.bin):\n' +
  '   - For English (default, ~142MB):\n' +
  '     mkdir -p ~/.cache/whisper2opencode\n' +
  '     curl -L -o ~/.cache/whisper2opencode/ggml-base.en.bin \\\n' +
  '       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin\n' +
  '   - For Multilingual (e.g. Polish, Spanish, German):\n' +
  '     curl -L -o ~/.cache/whisper2opencode/ggml-base.bin \\\n' +
  '       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin\n\n' +
  '3. (Optional) Point to a custom model path via environment variable:\n' +
  '   export WHISPER_MODEL_PATH="~/.cache/whisper2opencode/ggml-base.en.bin"';

const isOptionsObject = (candidate: unknown): candidate is LoadWhisperFactoryOptions =>
  Boolean(candidate) &&
  typeof candidate === 'object' &&
  !Array.isArray(candidate) &&
  ('overrideFactory' in (candidate as object) || 'moduleLoader' in (candidate as object) || 'targetDirectory' in (candidate as object));

export function loadWhisperFactory(factoryOrOptions?: LoadWhisperFactoryOptions | unknown, ...restArguments: unknown[]): WhisperFactory {
  const options: LoadWhisperFactoryOptions = isOptionsObject(factoryOrOptions)
    ? (factoryOrOptions as LoadWhisperFactoryOptions)
    : {
        overrideFactory: factoryOrOptions,
        moduleLoader: typeof restArguments[0] === 'function' ? (restArguments[0] as (id: string) => unknown) : require,
        targetDirectory: typeof restArguments[1] === 'string' ? restArguments[1] : undefined,
      };

  const loader = options.moduleLoader ?? require;
  const factory = resolveFactory(options, loader);
  if (!factory) {
    throw new Error(WHISPER_PACKAGE_MISSING_MESSAGE);
  }
  return factory;
}

interface WhisperInferenceParameters {
  whisperFactory: WhisperFactory;
  modelData: Buffer;
  pcm: Float32Array;
  language: string;
  resolvedModelPath: string;
}

const parseSegmentLines = (stdoutLines: readonly string[]): TranscriptionSegment[] => {
  const segments: TranscriptionSegment[] = [];
  for (const line of stdoutLines) {
    const match = SEGMENT_REGEX.exec(line.trim());
    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }
    const text = match[3].trim();
    if (text.length === 0) {
      continue;
    }
    segments.push({
      startMs: parseTimestampToMs(match[1]),
      endMs: parseTimestampToMs(match[2]),
      text,
    });
  }
  return segments;
};

const executeWhisperSession = (
  whisper: WhisperInstance,
  context: { parameters: WhisperInferenceParameters; stderrLines: readonly string[] },
): void => {
  whisper.FS_createDataFile('/', 'whisper.bin', context.parameters.modelData, true, true);
  if (!whisper.init('whisper.bin')) {
    throw new Error(
      `whisper.cpp failed to initialize model from "${context.parameters.resolvedModelPath}". Hint: Ensure the model is a valid whisper.cpp GGML .bin file (not PyTorch/ONNX/Safetensors). If using the cached default model, delete "${context.parameters.resolvedModelPath}" and retry so it re-downloads.`,
    );
  }

  const code = whisper.full_default(context.parameters.pcm, context.parameters.language, false);
  if (code === 0) {
    return;
  }

  const errorDetail = context.stderrLines.slice(-TAIL_ERROR_LINES_COUNT).join(' | ');
  const detailSuffix = errorDetail ? ` (${errorDetail})` : '';
  throw new Error(
    `whisper.cpp transcription failed with code ${code}${detailSuffix}. Hint: Check that 'language' ("${context.parameters.language}") is a valid ISO 639-1 code (e.g. 'en', 'pl', 'de', 'es'). For non-English audio, provide a multilingual GGML model (e.g. ggml-base.bin) via 'modelPath'.`,
  );
};

const runWhisperInference = async (parameters: WhisperInferenceParameters): Promise<TranscriptionSegment[]> => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const whisper = await parameters.whisperFactory({
    print: (text: string) => {
      stdoutLines.push(text);
    },
    printErr: (text: string) => {
      stderrLines.push(text);
    },
  });

  try {
    executeWhisperSession(whisper, { parameters, stderrLines });
  } finally {
    whisper.free();
    whisper.PThread?.terminateAllThreads();
  }

  return parseSegmentLines(stdoutLines);
};

export async function transcribeAudioFile(options: TranscribeOptions): Promise<string> {
  const baseDirectory = options.directory ?? process.cwd();
  const { resolvedPath: resolvedInputPath, stat } = resolveMediaFile(options.filePath, baseDirectory, 'filePath');
  const resolvedModelPath = await resolveModelPath(options.modelPath, baseDirectory);
  const language = options.language?.trim() || 'en';
  const cacheKey = `${resolvedInputPath}:${stat.mtimeMs}:${stat.size}:${language}:${resolvedModelPath}`;

  let result = transcriptionCache.get(cacheKey);
  if (!result) {
    const modelData = fileSystem.readFileSync(resolvedModelPath);
    const pcm = decodeAudioToFloat32(resolvedInputPath);
    const durationMs = Math.round((pcm.length / SAMPLE_RATE) * MILLISECONDS_PER_SECOND);
    const whisperFactory = loadWhisperFactory(options.whisperFactory, require, baseDirectory);

    const segments = await runWhisperInference({
      whisperFactory,
      modelData,
      pcm,
      language,
      resolvedModelPath,
    });

    result = { segments, durationMs };
    transcriptionCache.set(cacheKey, result);
  }

  const clampedDurationMs = Math.max(0, Math.round(result.durationMs));
  const secondsString = (clampedDurationMs / MILLISECONDS_PER_SECOND).toFixed(DURATION_DECIMAL_PLACES);
  const headerLines = [
    `Filename: ${path.basename(resolvedInputPath)}`,
    `File type: ${getFileType(resolvedInputPath)}`,
    `Duration: ${formatMsToTimestamp(clampedDurationMs)} (${secondsString}s)`,
  ];
  const wordLines = formatWordLines(result.segments);

  return wordLines.length > 0 ? `${headerLines.join('\n')}\n\n${wordLines.join('\n')}` : headerLines.join('\n');
}
