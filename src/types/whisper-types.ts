import type { execFileSync } from 'node:child_process';

export type WhisperInstance = {
  FS_createDataFile(parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean): void;
  init(pathModel: string): boolean;
  full_default(audio: Float32Array, language: string, isTranslate: boolean): number;
  free(): void;
  PThread?: {
    terminateAllThreads(): void;
  };
};

export type WhisperFactory = (moduleOverrides?: { print?: (text: string) => void; printErr?: (text: string) => void }) => Promise<WhisperInstance>;

export type TranscriptionSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptionMediaResult = {
  segments: TranscriptionSegment[];
  durationMs: number;
};

export type SupportedConvertFormat = 'wav' | 'mp3' | 'ogg' | 'flac' | 'm4a' | 'pcmf32';

export type TranscribeOptions = {
  filePath: string;
  language?: string;
  modelPath?: string;
  directory?: string;
  whisperFactory?: unknown;
};

export type ConvertAudioOptions = {
  inputPath: string;
  outputPath?: string;
  format?: SupportedConvertFormat;
  sampleRate?: number;
  channels?: number;
  overwrite?: boolean;
  isOverwrite?: boolean;
  directory?: string;
};

export type TranscriptionFileMetadata = {
  sourceFile: string;
  duration: string;
};

export type SaveTranscriptionOptions = {
  filePath: string;
  content: string;
  sourceFile?: string;
  duration?: string;
  directory?: string;
};

export type DownloadWhisperOptions = {
  modelName?: string;
  skipModel?: boolean;
  directory?: string;
  moduleLoader?: (identifier: string) => unknown;
};

export type DownloadWhisperResult = {
  directory: string;
  packageStatus: string;
  modelName?: string;
  modelPath?: string;
  modelStatus?: string;
  summary: string;
};

export interface ResolveMediaOptions {
  inputPath: string | undefined;
  baseDirectory: string;
  argumentName: 'filePath' | 'inputPath';
}

export interface LoadWhisperFactoryOptions {
  overrideFactory?: unknown;
  moduleLoader?: (identifier: string) => unknown;
  targetDirectory?: string;
}

export interface InstallWhisperPackageOptions {
  targetDirectory: string;
  processRunner?: typeof execFileSync;
  fetchImpl?: typeof fetch;
}
