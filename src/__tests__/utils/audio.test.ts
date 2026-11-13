import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import '../mock-ffmpeg.js';
import { mockFfmpegState } from '../mock-ffmpeg.js';

import { convert_audio } from '../../tools/convert_audio.js';
import {
  SAMPLE_RATE,
  convertAudioFile,
  decodeAudioToFloat32,
  getFileType,
  getFfmpegBinary,
  isVideoFile,
  resolveMediaFile,
} from '../../utils/audio.js';
import { FIXTURES_DIR, MOCK_AUDIO_PATH, createTestContext } from '../fixtures.js';

describe('audio utilities and convert_audio tool', () => {
  beforeEach(() => {
    mockFfmpegState.reset();
  });

  test('isVideoFile and getFileType classify audio and video paths', () => {
    expect(SAMPLE_RATE).toBe(16000);
    expect(isVideoFile('clip.mp4')).toBe(true);
    expect(isVideoFile('MOVIE.MKV')).toBe(true);
    expect(isVideoFile('voice.wav')).toBe(false);
    expect(isVideoFile('song.mp3')).toBe(false);

    expect(getFileType('sample.wav')).toBe('audio/wav');
    expect(getFileType(path.join('media', 'clip.MP4'))).toBe('video/mp4');
    expect(getFileType('noext')).toBe('audio');
  });

  test('getFfmpegBinary resolves mocked ffmpeg executable path and handles missing binary with hints', () => {
    const bin = getFfmpegBinary();
    expect(typeof bin).toBe('string');
    expect(bin).toBe('/mock/bin/ffmpeg');

    expect(getFfmpegBinary({ default: '/custom/bin/ffmpeg' })).toBe('/custom/bin/ffmpeg');
    expect(() => getFfmpegBinary(null)).toThrow(/ffmpeg-static binary is not available for this platform[\s\S]*Hint:/);
    expect(() => getFfmpegBinary('')).toThrow(/ffmpeg-static binary is not available for this platform[\s\S]*Hint:/);
  });

  test('resolveMediaFile validates media paths and provides recovery hints', () => {
    const mockAudioFilename = path.basename(MOCK_AUDIO_PATH);
    const { resolvedPath, stat } = resolveMediaFile(mockAudioFilename, FIXTURES_DIR, 'filePath');
    expect(resolvedPath).toBe(path.resolve(FIXTURES_DIR, mockAudioFilename));
    expect(stat.size).toBeGreaterThan(0);

    expect(() => resolveMediaFile('   ', FIXTURES_DIR, 'filePath')).toThrow(/Missing required 'filePath' argument[\s\S]*Hint:/);

    const missingPath = path.join(FIXTURES_DIR, 'missing.wav');
    expect(() => resolveMediaFile(missingPath, FIXTURES_DIR, 'inputPath')).toThrow(/Source media file not found:[\s\S]*Hint:/);

    expect(() => resolveMediaFile(FIXTURES_DIR, FIXTURES_DIR, 'filePath')).toThrow(/Path is a directory[\s\S]*Hint:/);

    const emptyFile = path.join(os.tmpdir(), `whisper2opencode-empty-${process.pid}.wav`);
    fs.writeFileSync(emptyFile, '');
    try {
      expect(() => resolveMediaFile(emptyFile, FIXTURES_DIR, 'filePath')).toThrow(/Audio\/video file is empty \(0 bytes\)[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
    }
  });

  test('decodeAudioToFloat32 decodes valid media and rejects corrupted or silent inputs with hints', () => {
    const samples = decodeAudioToFloat32(MOCK_AUDIO_PATH);
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Math.round(samples.length / SAMPLE_RATE)).toBe(1);

    // Valid .pcmf32 file
    const validPcmPath = path.join(os.tmpdir(), `whisper2opencode-valid-${process.pid}.pcmf32`);
    const pcmData = new Float32Array(SAMPLE_RATE);
    fs.writeFileSync(validPcmPath, Buffer.from(pcmData.buffer));
    try {
      const pcmSamples = decodeAudioToFloat32(validPcmPath);
      expect(pcmSamples).toBeInstanceOf(Float32Array);
      expect(pcmSamples.length).toBe(SAMPLE_RATE);
    } finally {
      if (fs.existsSync(validPcmPath)) fs.unlinkSync(validPcmPath);
    }

    // Corrupted / invalid media format
    const invalidAudioPath = path.join(os.tmpdir(), `whisper2opencode-invalid-${process.pid}.mp3`);
    fs.writeFileSync(invalidAudioPath, '<html><body>404 Not Found</body></html>');
    mockFfmpegState.filePathModes.set(invalidAudioPath, 'invalid-format');
    try {
      expect(() => decodeAudioToFloat32(invalidAudioPath)).toThrow(/Failed to decode audio[\s\S]*invalid or corrupted media format[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(invalidAudioPath)) fs.unlinkSync(invalidAudioPath);
    }

    // Generic decode error
    const genericErrorPath = path.join(os.tmpdir(), `whisper2opencode-generic-${process.pid}.mp3`);
    fs.writeFileSync(genericErrorPath, 'generic-error-content');
    mockFfmpegState.filePathModes.set(genericErrorPath, 'generic');
    try {
      expect(() => decodeAudioToFloat32(genericErrorPath)).toThrow(/Failed to decode audio[\s\S]*ffmpeg generic decode error[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(genericErrorPath)) fs.unlinkSync(genericErrorPath);
    }

    // Generic decode error without stderr buffer
    const noStderrPath = path.join(os.tmpdir(), `whisper2opencode-nostderr-${process.pid}.mp3`);
    fs.writeFileSync(noStderrPath, 'mock-no-stderr');
    mockFfmpegState.filePathModes.set(noStderrPath, 'generic-no-stderr');
    try {
      expect(() => decodeAudioToFloat32(noStderrPath)).toThrow(/Failed to decode audio[\s\S]*ffmpeg execution failure without stderr[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(noStderrPath)) fs.unlinkSync(noStderrPath);
    }

    // Empty .pcmf32 file (< 4 bytes)
    const tinyPcmPath = path.join(os.tmpdir(), `whisper2opencode-tiny-${process.pid}.pcmf32`);
    fs.writeFileSync(tinyPcmPath, Buffer.from([1, 2]));
    try {
      expect(() => decodeAudioToFloat32(tinyPcmPath)).toThrow(/contains 0 samples[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(tinyPcmPath)) fs.unlinkSync(tinyPcmPath);
    }

    // 0 samples returned from audio decode
    const zeroSamplesPath = path.join(os.tmpdir(), `whisper2opencode-zerosamples-${process.pid}.wav`);
    fs.writeFileSync(zeroSamplesPath, 'mock-audio');
    mockFfmpegState.filePathModes.set(zeroSamplesPath, 'zero-samples');
    try {
      expect(() => decodeAudioToFloat32(zeroSamplesPath)).toThrow(/contains 0 samples[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(zeroSamplesPath)) fs.unlinkSync(zeroSamplesPath);
    }

    // Silent video without an audio stream
    const silentVideoPath = path.join(os.tmpdir(), `whisper2opencode-silent-${process.pid}.mp4`);
    fs.writeFileSync(silentVideoPath, 'mock-silent-video');
    mockFfmpegState.filePathModes.set(silentVideoPath, 'no-stream');
    try {
      expect(() => decodeAudioToFloat32(silentVideoPath)).toThrow(/Failed to isolate audio from video[\s\S]*no audio stream found[\s\S]*Hint:/);
    } finally {
      if (fs.existsSync(silentVideoPath)) fs.unlinkSync(silentVideoPath);
    }
  });

  test('convert_audio tool and convertAudioFile convert formats and enforce path/overwrite guards', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-convert-${process.pid}-`));
    const ctx = createTestContext(tempDir);

    const outputPcmPath = path.join(tempDir, 'converted.pcmf32');
    const outputWavPath = path.join(tempDir, 'converted.wav');
    try {
      const resultPath = await convert_audio.execute(
        {
          inputPath: MOCK_AUDIO_PATH,
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
      expect(Math.round(decoded.length / SAMPLE_RATE)).toBe(1);

      // Rejects when overwrite is false and output already exists
      expect(() =>
        convertAudioFile({
          inputPath: MOCK_AUDIO_PATH,
          outputPath: outputPcmPath,
          format: 'pcmf32',
          overwrite: false,
        }),
      ).toThrow(/Output file already exists:[\s\S]*Hint:/);

      // Rejects when outputPath equals inputPath
      expect(() =>
        convertAudioFile({
          inputPath: MOCK_AUDIO_PATH,
          outputPath: MOCK_AUDIO_PATH,
          format: 'wav',
        }),
      ).toThrow(/cannot be the same as input path[\s\S]*Hint:/);

      // Rejects missing source file
      const missingSource = path.join(tempDir, 'nonexistent-source.mp4');
      await expect(
        convert_audio.execute(
          {
            inputPath: missingSource,
            format: 'wav',
          },
          ctx,
        ),
      ).rejects.toThrow(/Source media file not found:[\s\S]*Hint:/);

      // Output path generation when outputPath is omitted
      const autoPath = convertAudioFile({
        inputPath: MOCK_AUDIO_PATH,
        outputPath: outputWavPath,
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
        overwrite: true,
      });
      expect(autoPath).toBe(outputWavPath);
      expect(fs.existsSync(outputWavPath)).toBe(true);

      // Output path generation when candidate matches input path (adds .converted.)
      const inputCopy = path.join(tempDir, 'source.wav');
      fs.copyFileSync(MOCK_AUDIO_PATH, inputCopy);
      const autoConvertedPath = convertAudioFile({
        inputPath: inputCopy,
        format: 'wav',
        overwrite: true,
      });
      expect(autoConvertedPath).toBe(path.join(tempDir, 'source.converted.wav'));
      expect(fs.existsSync(autoConvertedPath)).toBe(true);

      // Rejects when conversion encounters no audio stream
      mockFfmpegState.convertMode = 'no-stream';
      expect(() =>
        convertAudioFile({
          inputPath: MOCK_AUDIO_PATH,
          outputPath: path.join(tempDir, 'fail-nostream.wav'),
          format: 'wav',
          overwrite: true,
        }),
      ).toThrow(/Failed to convert[\s\S]*no audio stream found[\s\S]*Hint:/);

      // Rejects when conversion encounters generic ffmpeg failure
      mockFfmpegState.convertMode = 'generic';
      expect(() =>
        convertAudioFile({
          inputPath: MOCK_AUDIO_PATH,
          outputPath: path.join(tempDir, 'fail-generic.wav'),
          format: 'wav',
          overwrite: true,
        }),
      ).toThrow(/Failed to convert[\s\S]*ffmpeg generic convert failure[\s\S]*Hint:/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
