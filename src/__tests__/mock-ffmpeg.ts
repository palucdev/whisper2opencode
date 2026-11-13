import { mock } from 'bun:test';
import * as realCp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createMockWavBuffer } from './fixtures.js';

export type MockFfmpegDecodeMode = 'success' | 'no-stream' | 'invalid-format' | 'generic' | 'generic-no-stderr' | 'zero-samples';
export type MockFfmpegConvertMode = 'success' | 'no-stream' | 'generic' | 'generic-no-stderr';

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

const mockExecFileSync = (file: string | URL, args?: readonly string[], options?: unknown) => {
  const fileStr = String(file);
  const argsArr = (args || []).map(String);
  const isFfmpeg = fileStr.includes('ffmpeg') || argsArr.includes('-hide_banner');
  if (!isFfmpeg) {
    return (realCp.execFileSync as any)(file, args, options);
  }

  const iIdx = argsArr.indexOf('-i');
  const inputPath = iIdx !== -1 ? argsArr[iIdx + 1] : undefined;
  const isDecode = argsArr.includes('pipe:1');

  if (isDecode) {
    const mode = (inputPath && mockFfmpegState.filePathModes.get(inputPath)) || mockFfmpegState.decodeMode;
    if (mode === 'no-stream') {
      const err = new Error('ffmpeg failed');
      (err as any).stderr = Buffer.from('Output file does not contain any stream');
      throw err;
    }
    if (mode === 'invalid-format') {
      const err = new Error('ffmpeg failed');
      (err as any).stderr = Buffer.from('Invalid data found when processing input');
      throw err;
    }
    if (mode === 'generic') {
      const err = new Error('ffmpeg failed');
      (err as any).stderr = Buffer.from('ffmpeg generic decode error');
      throw err;
    }
    if (mode === 'generic-no-stderr') {
      throw new Error('ffmpeg execution failure without stderr');
    }
    if (mode === 'zero-samples') {
      return Buffer.alloc(0);
    }

    const pcm = new Float32Array(16000);
    return Buffer.from(pcm.buffer);
  }

  const mode = (inputPath && mockFfmpegState.filePathModes.get(inputPath)) || mockFfmpegState.convertMode;
  if (mode === 'no-stream') {
    const err = new Error('ffmpeg failed');
    (err as any).stderr = Buffer.from('Output file does not contain any stream');
    throw err;
  }
  if (mode === 'generic') {
    const err = new Error('ffmpeg failed');
    (err as any).stderr = Buffer.from('ffmpeg generic convert failure');
    throw err;
  }

  const outputPath = argsArr[argsArr.length - 1];
  if (outputPath && typeof outputPath === 'string') {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (outputPath.endsWith('.pcmf32')) {
      fs.writeFileSync(outputPath, Buffer.from(new Float32Array(16000).buffer));
    } else if (outputPath.endsWith('.wav')) {
      fs.writeFileSync(outputPath, createMockWavBuffer(1, 16000));
    } else {
      fs.writeFileSync(outputPath, Buffer.from('mock-converted-media'));
    }
  }

  return Buffer.alloc(0);
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
