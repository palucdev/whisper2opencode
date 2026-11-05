export type WhisperInstance = {
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

export type WhisperFactory = (moduleOverrides?: {
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<WhisperInstance>;

export type TranscriptionSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptionMediaResult = {
  segments: TranscriptionSegment[];
  durationMs: number;
};

export type SupportedConvertFormat =
  | "wav"
  | "mp3"
  | "ogg"
  | "flac"
  | "m4a"
  | "pcmf32";

export type TranscribeOptions = {
  filePath: string;
  language?: string;
  modelPath?: string;
  directory?: string;
};

export type ConvertAudioOptions = {
  inputPath: string;
  outputPath?: string;
  format?: SupportedConvertFormat;
  sampleRate?: number;
  channels?: number;
  overwrite?: boolean;
  directory?: string;
};

export type SaveTranscriptionOptions = {
  filePath: string;
  content: string;
  directory?: string;
};

