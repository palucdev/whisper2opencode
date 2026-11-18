import { mock } from 'bun:test';
import * as realCp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createMockWavBuffer } from './fixtures.js';

export type MockFfmpegDecodeMode = 'success' | 'no-stream' | 'invalid-format' | 'generic' | 'generic-no-stderr' | 'zero-samples';
export type MockFfmpegConvertMode = 'success' | 'no-stream' | 'generic' | 'generic-no-stderr';

const MOCK_PCM_SAMPLE_COUNT = 16_000;

interface FfmpegExecError extends Error {
  stderr?: Buffer;
}

const createFfmpegError = (message: string, stderrOutput?: string): FfmpegExecError => {
  const ffmpegError: FfmpegExecError = new Error(message);
  if (stderrOutput !== undefined) {
    ffmpegError.stderr = Buffer.from(stderrOutput);
  }
  return ffmpegError;
};

export const mockFfmpegState = {
  decodeMode: 'success' as MockFfmpegDecodeMode,
  convertMode: 'success' as MockFfmpegConvertMode,
  filePathModes: new Map<string, MockFfmpegDecodeMode | MockFfmpegConvertMode>(),
  reset() {
    mockFfmpegState.decodeMode = 'success';
    mockFfmpegState.convertMode = 'success';
    mockFfmpegState.filePathModes.clear();
  },
};

const handleMockDecode = (inputPath: string | undefined): Buffer => {
  const mode = (inputPath !== undefined && mockFfmpegState.filePathModes.get(inputPath)) || mockFfmpegState.decodeMode;
  if (mode === 'no-stream') {
    throw createFfmpegError('ffmpeg failed', 'Output file does not contain any stream');
  }
  if (mode === 'invalid-format') {
    throw createFfmpegError('ffmpeg failed', 'Invalid data found when processing input');
  }
  if (mode === 'generic') {
    throw createFfmpegError('ffmpeg failed', 'ffmpeg generic decode error');
  }
  if (mode === 'generic-no-stderr') {
    throw createFfmpegError('ffmpeg execution failure without stderr');
  }
  if (mode === 'zero-samples') {
    return Buffer.alloc(0);
  }

  const pcm = new Float32Array(MOCK_PCM_SAMPLE_COUNT);
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
};

const writeConvertedOutput = (outputPath: string): void => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (outputPath.endsWith('.pcmf32')) {
    const pcm = new Float32Array(MOCK_PCM_SAMPLE_COUNT);
    fs.writeFileSync(outputPath, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    return;
  }
  if (outputPath.endsWith('.wav')) {
    fs.writeFileSync(outputPath, createMockWavBuffer(1, MOCK_PCM_SAMPLE_COUNT));
    return;
  }
  fs.writeFileSync(outputPath, Buffer.from('mock-converted-media'));
};

const handleMockConvert = (inputPath: string | undefined, commandArguments: string[]): Buffer => {
  const mode = (inputPath !== undefined && mockFfmpegState.filePathModes.get(inputPath)) || mockFfmpegState.convertMode;
  if (mode === 'no-stream') {
    throw createFfmpegError('ffmpeg failed', 'Output file does not contain any stream');
  }
  if (mode === 'generic') {
    throw createFfmpegError('ffmpeg failed', 'ffmpeg generic convert failure');
  }

  const outputPath = commandArguments.at(-1);
  if (typeof outputPath === 'string') {
    writeConvertedOutput(outputPath);
  }

  return Buffer.alloc(0);
};

const extractInputPath = (commandArguments: string[]): string | undefined => {
  const inputFlagIndex = commandArguments.indexOf('-i');
  return inputFlagIndex === -1 ? undefined : commandArguments[inputFlagIndex + 1];
};

const mockExecFileSync = (file: string | URL, ...restArguments: unknown[]): Buffer => {
  const fileString = String(file);
  const rawArguments = Array.isArray(restArguments[0]) ? restArguments[0] : [];
  const commandArguments = (rawArguments as unknown[]).map(String);
  const isFfmpeg = fileString.includes('ffmpeg') || commandArguments.includes('-hide_banner');
  if (!isFfmpeg) {
    return Reflect.apply(realCp.execFileSync, realCp, [file, ...restArguments]) as Buffer;
  }

  const inputPath = extractInputPath(commandArguments);
  const isDecode = commandArguments.includes('pipe:1');

  return isDecode ? handleMockDecode(inputPath) : handleMockConvert(inputPath, commandArguments);
};

mock.module('node:child_process', () => ({
  ...realCp,
  execFileSync: mockExecFileSync,
}));

mock.module('child_process', () => ({
  ...realCp,
  execFileSync: mockExecFileSync,
}));

mock.module('ffmpeg-static', () => ({
  default: '/mock/bin/ffmpeg',
  __esModule: true,
}));
