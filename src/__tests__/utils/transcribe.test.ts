import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { save_transcription } from '../../tools/save_transcription.js';
import { transcribe } from '../../tools/transcribe.js';
import { saveTranscriptionFile, transcribeAudioFile } from '../../utils/transcribe.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string;

function createTestContext(dir = '/home/projekty/whisper2opencode') {
  return {
    sessionID: 'test-session',
    messageID: 'test-msg',
    agent: 'build',
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } as any;
}

const WORD_LINE_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$/;
const DURATION_REGEX = /^(\d{2}:\d{2}:\d{2}\.\d{3}) \((\d+(?:\.\d+)?)s\)$/;

function parseTranscriptionOutput(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines.length).toBeGreaterThan(3);

  expect(lines[0]).toMatch(/^Filename:\s+.+$/);
  expect(lines[1]).toMatch(/^File type:\s+.+$/);
  expect(lines[2]).toMatch(/^Duration:\s+\d{2}:\d{2}:\d{2}\.\d{3} \(\d+(?:\.\d+)?s\)$/);

  const filename = lines[0]!.replace(/^Filename:\s+/, '');
  const fileType = lines[1]!.replace(/^File type:\s+/, '');
  const durationRaw = lines[2]!.replace(/^Duration:\s+/, '');
  const durationMatch = DURATION_REGEX.exec(durationRaw);
  expect(durationMatch).not.toBeNull();

  const words = lines.slice(3).map((line) => {
    const match = WORD_LINE_REGEX.exec(line);
    expect(match).not.toBeNull();
    return {
      start: match![1]!,
      end: match![2]!,
      word: match![3]!,
    };
  });

  return {
    metadata: {
      filename,
      fileType,
      durationTimestamp: durationMatch![1]!,
      durationSeconds: Number(durationMatch![2]!),
    },
    words,
  };
}

describe('transcribe and save_transcription tools', () => {
  test('transcribe tool returns file metadata and a timestamped list of spoken words', async () => {
    const output = (await transcribe.execute(
      {
        filePath: '/tmp/opencode/jfk.wav',
        language: 'en',
        modelPath: '/tmp/opencode/ggml-tiny.en.bin',
      },
      createTestContext(),
    )) as string;

    expect(typeof output).toBe('string');
    const { metadata, words: entries } = parseTranscriptionOutput(output);
    expect(metadata.filename).toBe('jfk.wav');
    expect(metadata.fileType).toBe('audio/wav');
    expect(metadata.durationTimestamp).toBe('00:00:11.000');
    expect(metadata.durationSeconds).toBe(11);

    const reconstructedText = entries.map((e) => e.word.toLowerCase()).join(' ');
    expect(reconstructedText).toContain('fellow americans');
    expect(reconstructedText).toContain('what you can do for your country');

    const countryMatches = entries.filter((e) => e.word.toLowerCase() === 'country');
    expect(countryMatches.length).toBe(2);
    expect(countryMatches[1]!.start > countryMatches[0]!.start).toBe(true);
  }, 30_000);

  test('transcribe tool isolates audio from video files and transcribes into metadata and timestamped words', async () => {
    const videoPath = path.join(os.tmpdir(), `whisper2opencode-test-video-${process.pid}.mp4`);

    try {
      execFileSync(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=160x120:r=5',
          '-i',
          '/tmp/opencode/jfk.wav',
          '-shortest',
          '-c:v',
          'mpeg4',
          '-c:a',
          'aac',
          videoPath,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const output = (await transcribe.execute(
        {
          filePath: videoPath,
          language: 'en',
          modelPath: '/tmp/opencode/ggml-tiny.en.bin',
        },
        createTestContext(),
      )) as string;

      expect(typeof output).toBe('string');
      const { metadata, words: entries } = parseTranscriptionOutput(output);
      expect(metadata.filename).toBe(path.basename(videoPath));
      expect(metadata.fileType).toBe('video/mp4');
      expect(metadata.durationSeconds).toBeGreaterThanOrEqual(10.9);
      expect(metadata.durationSeconds).toBeLessThanOrEqual(11.2);

      const reconstructedText = entries.map((e) => e.word.toLowerCase()).join(' ');
      expect(reconstructedText).toContain('fellow americans');
      expect(reconstructedText).toContain('what you can do for your country');
    } finally {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    }
  }, 30_000);

  test('transcribe tool caches transcription results for unchanged files', async () => {
    const ctx = createTestContext();

    const first = await transcribe.execute(
      {
        filePath: '/tmp/opencode/jfk.wav',
        language: 'en',
        modelPath: '/tmp/opencode/ggml-tiny.en.bin',
      },
      ctx,
    );

    const start = performance.now();
    const second = await transcribe.execute(
      {
        filePath: '/tmp/opencode/jfk.wav',
        language: 'en',
        modelPath: '/tmp/opencode/ggml-tiny.en.bin',
      },
      ctx,
    );
    const elapsedMs = performance.now() - start;

    expect(second).toBe(first);
    expect(elapsedMs).toBeLessThan(100);
  }, 30_000);

  test('transcribe tool provides actionable recovery hints on media and model errors', async () => {
    const ctx = createTestContext();

    // Missing audio/video file
    await expect(
      transcribe.execute(
        {
          filePath: '/tmp/opencode/does-not-exist.mp3',
          modelPath: '/tmp/opencode/ggml-tiny.en.bin',
        },
        ctx,
      ),
    ).rejects.toThrow(/Audio\/video file not found:[\s\S]*Hint:/);

    // Missing custom model file
    await expect(
      transcribe.execute(
        {
          filePath: '/tmp/opencode/jfk.wav',
          modelPath: '/tmp/opencode/missing-model.bin',
        },
        ctx,
      ),
    ).rejects.toThrow(/Whisper model file not found at:[\s\S]*Hint:/);

    // Directory passed as modelPath
    await expect(
      transcribe.execute(
        {
          filePath: '/tmp/opencode/jfk.wav',
          modelPath: '/tmp/opencode',
        },
        ctx,
      ),
    ).rejects.toThrow(/Whisper model path is invalid \(is a directory\):[\s\S]*Hint:/);
  });

  test('save_transcription tool saves new .txt transcription files in the working directory and blocks unsafe operations', async () => {
    const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-save-${process.pid}-`));
    const ctx = createTestContext(tempWorkDir);

    try {
      // Saves a .txt transcription file inside the working directory
      const savedPath = (await save_transcription.execute(
        {
          filePath: 'transcripts/jfk.transcription.txt',
          content: 'And so my fellow Americans, ask not what your country can do for you.',
        },
        ctx,
      )) as string;

      expect(savedPath).toBe(path.join(tempWorkDir, 'transcripts', 'jfk.transcription.txt'));
      expect(fs.readFileSync(savedPath, 'utf8')).toBe('And so my fellow Americans, ask not what your country can do for you.');

      // Automatically appends .txt when no extension is provided
      const autoExtPath = (await save_transcription.execute(
        {
          filePath: 'jfk-notes',
          content: 'Timestamped transcript content',
        },
        ctx,
      )) as string;
      expect(autoExtPath).toBe(path.join(tempWorkDir, 'jfk-notes.txt'));
      expect(fs.existsSync(autoExtPath)).toBe(true);

      // Rejects overwriting an existing file
      await expect(
        save_transcription.execute(
          {
            filePath: 'jfk-notes.txt',
            content: 'Modified content',
          },
          ctx,
        ),
      ).rejects.toThrow(/Transcription file already exists:[\s\S]*Hint:/);

      // Rejects non-.txt file extensions
      expect(() =>
        saveTranscriptionFile({
          filePath: 'malicious.js',
          content: "console.log('nope');",
          directory: tempWorkDir,
        }),
      ).toThrow(/Invalid transcription file extension "\.js"[\s\S]*Only "\.txt" transcription files are allowed[\s\S]*Hint:/);

      // Rejects path traversal outside the working directory
      expect(() =>
        saveTranscriptionFile({
          filePath: '../outside.txt',
          content: 'escaped',
          directory: tempWorkDir,
        }),
      ).toThrow(/outside the working directory[\s\S]*Hint:/);

      // Rejects absolute paths outside the working directory
      expect(() =>
        saveTranscriptionFile({
          filePath: '/tmp/outside-work-dir.txt',
          content: 'escaped',
          directory: tempWorkDir,
        }),
      ).toThrow(/outside the working directory[\s\S]*Hint:/);

      // Rejects hidden files / directories
      expect(() =>
        saveTranscriptionFile({
          filePath: '.env',
          content: 'SECRET=1',
          directory: tempWorkDir,
        }),
      ).toThrow(/cannot target hidden files or directories[\s\S]*Hint:/);

      // Rejects missing filePath or empty content
      expect(() =>
        saveTranscriptionFile({
          filePath: '   ',
          content: 'valid content',
          directory: tempWorkDir,
        }),
      ).toThrow(/Missing required 'filePath' argument[\s\S]*Hint:/);

      expect(() =>
        saveTranscriptionFile({
          filePath: 'valid.txt',
          content: '   ',
          directory: tempWorkDir,
        }),
      ).toThrow(/Missing or empty 'content' argument[\s\S]*Hint:/);
    } finally {
      fs.rmSync(tempWorkDir, { recursive: true, force: true });
    }
  });
});
