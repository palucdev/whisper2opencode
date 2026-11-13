import { describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';

import '../mock-ffmpeg.js';

const mockWhisperState = {
  failInit: false,
  failFullDefault: false,
};

mock.module('whisper.cpp', () => {
  const factory = (options: { print: (text: string) => void; printErr: (text: string) => void }) => {
    return Promise.resolve({
      FS_createDataFile: () => {},
      init: () => {
        if (mockWhisperState.failInit) return false;
        return true;
      },
      full_default: () => {
        if (mockWhisperState.failFullDefault) {
          options.printErr('mock whisper execution failed');
          return 1;
        }
        options.print('[00:00:00.000 --> 00:00:00.500] And so my fellow Americans');
        options.print('[00:00:00.500 --> 00:00:01.000] ask not what you can do for your country ask what you can do for your country');
        return 0;
      },
      free: () => {},
      PThread: { terminateAllThreads: () => {} },
    });
  };
  return {
    default: factory,
    __esModule: true,
  };
});

import { save_transcription } from '../../tools/save_transcription.js';
import { transcribe } from '../../tools/transcribe.js';
import {
  TRANSCRIPTION_METADATA_REGEX,
  formatTranscriptionWithMetadata,
  saveTranscriptionFile,
  stripTranscriptionMetadata,
  transcribeAudioFile,
} from '../../utils/transcribe.js';
import { MOCK_AUDIO_PATH, MOCK_MODEL_PATH, MOCK_VIDEO_PATH, createTestContext } from '../fixtures.js';

/**
 * Matches a single timestamped word line from transcribe tool output.
 *
 * Example:
 *   "[00:00:00.000 --> 00:00:00.500] And"
 *
 * Captures:
 *   - match[1]: Start timestamp ("00:00:00.000")
 *   - match[2]: End timestamp ("00:00:00.500")
 *   - match[3]: Spoken word ("And")
 */
const WORD_LINE_REGEX = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$/;

/**
 * Matches formatted audio/video duration strings with timestamp and seconds in parentheses.
 *
 * Example:
 *   "00:00:11.000 (11.00s)"
 *
 * Captures:
 *   - match[1]: Duration timestamp ("00:00:11.000")
 *   - match[2]: Duration seconds ("11.00")
 */
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
        filePath: MOCK_AUDIO_PATH,
        language: 'en',
        modelPath: MOCK_MODEL_PATH,
      },
      createTestContext(),
    )) as string;

    expect(typeof output).toBe('string');
    const { metadata, words: entries } = parseTranscriptionOutput(output);
    expect(metadata.filename).toBe(path.basename(MOCK_AUDIO_PATH));
    expect(metadata.fileType).toBe('audio/wav');
    expect(metadata.durationTimestamp).toBe('00:00:01.000');
    expect(metadata.durationSeconds).toBe(1);

    const reconstructedText = entries.map((e) => e.word.toLowerCase()).join(' ');
    expect(reconstructedText).toContain('fellow americans');
    expect(reconstructedText).toContain('what you can do for your country');

    const countryMatches = entries.filter((e) => e.word.toLowerCase() === 'country');
    expect(countryMatches.length).toBe(2);
    expect(countryMatches[1]!.start > countryMatches[0]!.start).toBe(true);
  }, 30_000);

  test('transcribe tool isolates audio from video files and transcribes into metadata and timestamped words', async () => {
    const output = (await transcribe.execute(
      {
        filePath: MOCK_VIDEO_PATH,
        language: 'en',
        modelPath: MOCK_MODEL_PATH,
      },
      createTestContext(),
    )) as string;

    expect(typeof output).toBe('string');
    const { metadata, words: entries } = parseTranscriptionOutput(output);
    expect(metadata.filename).toBe(path.basename(MOCK_VIDEO_PATH));
    expect(metadata.fileType).toBe('video/mp4');
    expect(metadata.durationSeconds).toBeGreaterThanOrEqual(1.0);
    expect(metadata.durationSeconds).toBeLessThanOrEqual(1.1);

    const reconstructedText = entries.map((e) => e.word.toLowerCase()).join(' ');
    expect(reconstructedText).toContain('fellow americans');
    expect(reconstructedText).toContain('what you can do for your country');
  }, 30_000);

  test('transcribe tool caches transcription results for unchanged files', async () => {
    const ctx = createTestContext();

    const first = await transcribe.execute(
      {
        filePath: MOCK_AUDIO_PATH,
        language: 'en',
        modelPath: MOCK_MODEL_PATH,
      },
      ctx,
    );

    const start = performance.now();
    const second = await transcribe.execute(
      {
        filePath: MOCK_AUDIO_PATH,
        language: 'en',
        modelPath: MOCK_MODEL_PATH,
      },
      ctx,
    );
    const elapsedMs = performance.now() - start;

    expect(second).toBe(first);
    expect(elapsedMs).toBeLessThan(100);
  }, 30_000);

  test('transcribe tool provides actionable recovery hints on media and model errors', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-hints-${process.pid}-`));
    const ctx = createTestContext(tempDir);

    try {
      // Missing audio/video file
      const missingMedia = path.join(tempDir, 'does-not-exist.mp3');
      await expect(
        transcribe.execute(
          {
            filePath: missingMedia,
            modelPath: MOCK_MODEL_PATH,
          },
          ctx,
        ),
      ).rejects.toThrow(/Audio\/video file not found:[\s\S]*Hint:/);

      // Missing custom model file
      const missingModel = path.join(tempDir, 'missing-model.bin');
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            modelPath: missingModel,
          },
          ctx,
        ),
      ).rejects.toThrow(/Whisper model file not found at:[\s\S]*Hint:/);

      // Directory passed as modelPath
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            modelPath: tempDir,
          },
          ctx,
        ),
      ).rejects.toThrow(/Whisper model path is invalid \(is a directory\):[\s\S]*Hint:/);

      // Empty file passed as modelPath
      const emptyModel = path.join(tempDir, 'empty-model.bin');
      fs.writeFileSync(emptyModel, '');
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            modelPath: emptyModel,
          },
          ctx,
        ),
      ).rejects.toThrow(/Whisper model path is invalid \(file is empty\):[\s\S]*Hint:/);

      // Model initialization failure
      const failInitAudio = path.join(tempDir, 'fail-init.wav');
      fs.copyFileSync(MOCK_AUDIO_PATH, failInitAudio);
      mockWhisperState.failInit = true;
      try {
        await expect(
          transcribe.execute(
            {
              filePath: failInitAudio,
              modelPath: MOCK_MODEL_PATH,
            },
            ctx,
          ),
        ).rejects.toThrow(/whisper\.cpp failed to initialize model[\s\S]*Hint:/);
      } finally {
        mockWhisperState.failInit = false;
      }

      // Model execution failure
      const failExecAudio = path.join(tempDir, 'fail-exec.wav');
      fs.copyFileSync(MOCK_AUDIO_PATH, failExecAudio);
      mockWhisperState.failFullDefault = true;
      try {
        await expect(
          transcribe.execute(
            {
              filePath: failExecAudio,
              modelPath: MOCK_MODEL_PATH,
            },
            ctx,
          ),
        ).rejects.toThrow(/whisper\.cpp transcription failed with code 1[\s\S]*Hint:/);
      } finally {
        mockWhisperState.failFullDefault = false;
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('transcribe tool downloads and caches default model when modelPath is omitted with network and HTTP recovery hints', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-home-${process.pid}-`));
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(tempHome);
    const ctx = createTestContext();

    const originalFetch = globalThis.fetch;
    try {
      // 1. Network failure
      globalThis.fetch = () => Promise.reject(new Error('Connection timed out'));
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            language: 'en',
          },
          ctx,
        ),
      ).rejects.toThrow(/Failed to download default model from[\s\S]*Connection timed out[\s\S]*Hint:/);

      // 2. HTTP error response (!response.ok)
      globalThis.fetch = () =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        } as Response);
      await expect(
        transcribe.execute(
          {
            filePath: MOCK_AUDIO_PATH,
            language: 'en',
          },
          ctx,
        ),
      ).rejects.toThrow(/Failed to download default model \(503 Service Unavailable\)[\s\S]*Hint:/);

      // 3. Successful download and caching
      let fetchCallCount = 0;
      globalThis.fetch = () => {
        fetchCallCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: () => Promise.resolve(Buffer.from('ggml-downloaded-model-content')),
        } as Response);
      };

      const result1 = (await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
        },
        ctx,
      )) as string;
      expect(typeof result1).toBe('string');
      expect(fetchCallCount).toBe(1);

      // 4. Cache hit - reuses downloaded model without calling fetch again
      const result2 = (await transcribe.execute(
        {
          filePath: MOCK_AUDIO_PATH,
          language: 'en',
        },
        ctx,
      )) as string;
      expect(result2).toBe(result1);
      expect(fetchCallCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      homedirSpy.mockRestore();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test('save_transcription tool saves new .txt transcription files with metadata header and timestamped words per row, and blocks unsafe or plain-prose content', async () => {
    const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper2opencode-save-${process.pid}-`));
    const ctx = createTestContext(tempWorkDir);
    const audioBasename = path.basename(MOCK_AUDIO_PATH);

    try {
      // Saves a .txt transcription file inside the working directory with delimited metadata header and timestamped words per row
      const bodyText = [
        '[00:00:00.000 --> 00:00:00.320] And',
        '[00:00:00.320 --> 00:00:00.640] so',
        '[00:00:00.640 --> 00:00:00.960] my',
        '[00:00:00.960 --> 00:00:01.400] fellow',
        '[00:00:01.400 --> 00:00:02.100] Americans',
      ].join('\n');
      const savedPath = (await save_transcription.execute(
        {
          filePath: 'transcripts/test.transcription.txt',
          sourceFile: MOCK_AUDIO_PATH,
          duration: '00:00:01.000 (1.00s)',
          content: bodyText,
        },
        ctx,
      )) as string;

      expect(savedPath).toBe(path.join(tempWorkDir, 'transcripts', 'test.transcription.txt'));
      const savedContent = fs.readFileSync(savedPath, 'utf8');
      expect(savedContent).toBe(`---\nsource_file: ${audioBasename}\nduration: 00:00:01.000 (1.00s)\n---\n\n${bodyText}`);

      // Metadata is differentiated from body and easy to clean up automatically (regex, helper, and gray-matter)
      expect(stripTranscriptionMetadata(savedContent)).toBe(bodyText);
      expect(savedContent.replace(TRANSCRIPTION_METADATA_REGEX, '')).toBe(bodyText);
      const parsedMatter = matter(savedContent);
      expect(parsedMatter.data).toEqual({
        source_file: audioBasename,
        duration: '00:00:01.000 (1.00s)',
      });
      expect(parsedMatter.content.trim()).toBe(bodyText);

      // Every row in the stripped body is a timestamped word line
      for (const row of parsedMatter.content.trim().split('\n')) {
        expect(row).toMatch(WORD_LINE_REGEX);
      }

      // Automatically appends .txt when no extension is provided and accepts pre-formatted frontmatter in content without duplicating
      const autoExtBody = '[00:00:03.000 --> 00:00:03.400] ask\n[00:00:03.400 --> 00:00:03.800] not';
      const autoExtPath = (await save_transcription.execute(
        {
          filePath: 'mock-notes',
          content: `---\nsource_file: "${audioBasename}"\nduration: '00:00:01.000 (1.00s)'\n---\n\n${autoExtBody}`,
        },
        ctx,
      )) as string;
      expect(autoExtPath).toBe(path.join(tempWorkDir, 'mock-notes.txt'));
      expect(fs.readFileSync(autoExtPath, 'utf8')).toBe(`---\nsource_file: ${audioBasename}\nduration: 00:00:01.000 (1.00s)\n---\n\n${autoExtBody}`);

      // Converts raw transcribe header in content into --- frontmatter block while preserving timestamped word rows
      expect(
        formatTranscriptionWithMetadata({
          content: `Filename: sample.mp4\nFile type: video/mp4\nDuration: 00:01:05.000 (65.00s)\n\n[00:00:00.000 --> 00:00:00.500] Spoken\n[00:00:00.500 --> 00:00:01.000] video`,
        }),
      ).toBe(
        `---\nsource_file: sample.mp4\nduration: 00:01:05.000 (65.00s)\n---\n\n[00:00:00.000 --> 00:00:00.500] Spoken\n[00:00:00.500 --> 00:00:01.000] video`,
      );

      // Rejects plain reconstructed sentences or multi-word rows instead of one timestamped word per row
      expect(() =>
        saveTranscriptionFile({
          filePath: 'plain-prose.txt',
          sourceFile: audioBasename,
          duration: '00:00:01.000 (1.00s)',
          content: 'And so my fellow Americans, ask not what your country can do for you.',
          directory: tempWorkDir,
        }),
      ).toThrow(/Invalid transcription body format at line 1[\s\S]*sequence of timestamped words[\s\S]*Hint:/);

      expect(() =>
        saveTranscriptionFile({
          filePath: 'multi-word-row.txt',
          sourceFile: audioBasename,
          duration: '00:00:01.000 (1.00s)',
          content: '[00:00:00.000 --> 00:00:02.000] And so my fellow Americans',
          directory: tempWorkDir,
        }),
      ).toThrow(/Invalid transcription body format at line 1[\s\S]*sequence of timestamped words[\s\S]*Hint:/);

      // Rejects missing metadata when neither arguments nor frontmatter header are provided
      expect(() =>
        saveTranscriptionFile({
          filePath: 'missing-source.txt',
          content: '[00:00:00.000 --> 00:00:00.500] Hello',
          directory: tempWorkDir,
        }),
      ).toThrow(/Missing required source file metadata \('sourceFile'\)[\s\S]*Hint:/);

      expect(() =>
        saveTranscriptionFile({
          filePath: 'missing-duration.txt',
          sourceFile: audioBasename,
          content: '[00:00:00.000 --> 00:00:00.500] Hello',
          directory: tempWorkDir,
        }),
      ).toThrow(/Missing required audio\/video duration metadata \('duration'\)[\s\S]*Hint:/);

      expect(() =>
        formatTranscriptionWithMetadata({
          content: `---\nsource_file: ${audioBasename}\nduration: 00:00:01.000 (1.00s)\n---\n   `,
        }),
      ).toThrow(/Missing or empty transcription body in 'content'[\s\S]*Hint:/);

      // Rejects overwriting an existing file
      await expect(
        save_transcription.execute(
          {
            filePath: 'mock-notes.txt',
            sourceFile: audioBasename,
            duration: '00:00:01.000 (1.00s)',
            content: '[00:00:00.000 --> 00:00:00.500] Modified',
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
      const outsideWorkDir = path.resolve(tempWorkDir, '..', `outside-work-dir-${process.pid}.txt`);
      expect(() =>
        saveTranscriptionFile({
          filePath: outsideWorkDir,
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
