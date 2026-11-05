import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { convert_audio } from '../../tools/convert_audio.js';
import { SAMPLE_RATE, convertAudioFile, decodeAudioToFloat32, getFileType, isVideoFile, resolveMediaFile } from '../../utils/audio.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string;

function createTestContext() {
  return {
    sessionID: 'test-session',
    messageID: 'test-msg',
    agent: 'build',
    directory: '/home/projekty/whisper2opencode',
    worktree: '/home/projekty/whisper2opencode',
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } as any;
}

describe('audio utilities and convert_audio tool', () => {
  test('isVideoFile and getFileType classify audio and video paths', () => {
    expect(SAMPLE_RATE).toBe(16000);
    expect(isVideoFile('clip.mp4')).toBe(true);
    expect(isVideoFile('MOVIE.MKV')).toBe(true);
    expect(isVideoFile('voice.wav')).toBe(false);
    expect(isVideoFile('song.mp3')).toBe(false);

    expect(getFileType('/tmp/jfk.wav')).toBe('audio/wav');
    expect(getFileType('/tmp/clip.MP4')).toBe('video/mp4');
    expect(getFileType('/tmp/noext')).toBe('audio');
  });

  test('resolveMediaFile validates media paths and provides recovery hints', () => {
    const { resolvedPath, stat } = resolveMediaFile('jfk.wav', '/tmp/opencode', 'filePath');
    expect(resolvedPath).toBe('/tmp/opencode/jfk.wav');
    expect(stat.size).toBeGreaterThan(0);

    expect(() => resolveMediaFile('   ', '/tmp/opencode', 'filePath')).toThrow(/Missing required 'filePath' argument[\s\S]*Hint:/);

    expect(() => resolveMediaFile('/tmp/opencode/missing.wav', '/tmp/opencode', 'inputPath')).toThrow(/Source media file not found:[\s\S]*Hint:/);

    expect(() => resolveMediaFile('/tmp/opencode', '/tmp/opencode', 'filePath')).toThrow(/Path is a directory[\s\S]*Hint:/);

    const emptyFile = path.join(os.tmpdir(), `whisper2opencode-empty-${process.pid}.wav`);
    fs.writeFileSync(emptyFile, '');
    try {
      expect(() => resolveMediaFile(emptyFile, '/tmp/opencode', 'filePath')).toThrow(/Audio\/video file is empty \(0 bytes\)[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
    }
  });

  test('decodeAudioToFloat32 decodes valid media and rejects corrupted or silent inputs with hints', () => {
    const samples = decodeAudioToFloat32('/tmp/opencode/jfk.wav');
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Math.round(samples.length / SAMPLE_RATE)).toBe(11);

    // Corrupted / non-media file
    const invalidAudioPath = path.join(os.tmpdir(), `whisper2opencode-invalid-${process.pid}.mp3`);
    fs.writeFileSync(invalidAudioPath, '<html><body>404 Not Found</body></html>');
    try {
      expect(() => decodeAudioToFloat32(invalidAudioPath)).toThrow(/Failed to decode audio[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(invalidAudioPath)) fs.unlinkSync(invalidAudioPath);
    }

    // Empty .pcmf32 file (< 4 bytes)
    const tinyPcmPath = path.join(os.tmpdir(), `whisper2opencode-tiny-${process.pid}.pcmf32`);
    fs.writeFileSync(tinyPcmPath, Buffer.from([1, 2]));
    try {
      expect(() => decodeAudioToFloat32(tinyPcmPath)).toThrow(/contains 0 samples[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(tinyPcmPath)) fs.unlinkSync(tinyPcmPath);
    }

    // Silent video without an audio stream
    const silentVideoPath = path.join(os.tmpdir(), `whisper2opencode-silent-${process.pid}.mp4`);
    try {
      execFileSync(
        ffmpegPath,
        ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=5:d=1', '-an', '-c:v', 'mpeg4', silentVideoPath],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      expect(() => decodeAudioToFloat32(silentVideoPath)).toThrow(/Failed to isolate audio from video[\s\S]*no audio stream found[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(silentVideoPath)) fs.unlinkSync(silentVideoPath);
    }
  });

  test('convert_audio tool and convertAudioFile convert formats and enforce path/overwrite guards', async () => {
    const ctx = createTestContext();

    const outputPcmPath = path.join(os.tmpdir(), `whisper2opencode-converted-${process.pid}.pcmf32`);
    try {
      const resultPath = await convert_audio.execute(
        {
          inputPath: '/tmp/opencode/jfk.wav',
          outputPath: outputPcmPath,
          format: 'pcmf32',
          sampleRate: 16000,
          channels: 1,
          overwrite: true,
        },
        ctx,
      );

      expect(resultPath).toBe(outputPcmPath);
      expect(fs.existsSync(outputPcmPath)).toBe(true);
      const decoded = decodeAudioToFloat32(outputPcmPath);
      expect(Math.round(decoded.length / SAMPLE_RATE)).toBe(11);

      // Rejects when overwrite is false and output already exists
      expect(() =>
        convertAudioFile({
          inputPath: '/tmp/opencode/jfk.wav',
          outputPath: outputPcmPath,
          format: 'pcmf32',
          overwrite: false,
        }),
      ).toThrow(/Output file already exists:[\s\S]*Hint:/);

      // Rejects when outputPath equals inputPath
      expect(() =>
        convertAudioFile({
          inputPath: '/tmp/opencode/jfk.wav',
          outputPath: '/tmp/opencode/jfk.wav',
          format: 'wav',
        }),
      ).toThrow(/cannot be the same as input path[\s\S]*Hint:/);

      // Rejects missing source file
      await expect(
        convert_audio.execute(
          {
            inputPath: '/tmp/opencode/nonexistent-source.mp4',
            format: 'wav',
          },
          ctx,
        ),
      ).rejects.toThrow(/Source media file not found:[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(outputPcmPath)) {
        fs.unlinkSync(outputPcmPath);
      }
    }
  });
});
