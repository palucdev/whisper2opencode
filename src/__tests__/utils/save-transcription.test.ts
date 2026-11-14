import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

import { save_transcription } from '../../tools/save-transcription.js';
import { TRANSCRIPTION_METADATA_REGEX, formatTranscriptionWithMetadata, stripTranscriptionMetadata } from '../../utils/transcription-formatter.js';
import { saveTranscriptionFile } from '../../utils/transcription-saver.js';
import { MOCK_AUDIO_PATH, createTestContext } from '../fixtures.js';

const WORD_LINE_REGEX = /^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\] .+/;
const SAMPLE_DURATION = '00:00:01.000 (1.00s)';
const WHITESPACE_REPEAT_COUNT = 3;
const THREE_SPACES = ' '.repeat(WHITESPACE_REPEAT_COUNT);
const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'save-transcription');
const EXPECTED_SAVED_PATH = path.join(TEST_ROOT, 'transcripts', 'test.transcription.txt');
const EXPECTED_AUTO_EXTENSION_PATH = path.join(TEST_ROOT, 'mock-notes.txt');

const SAMPLE_BODY_LINES = [
  '[00:00:00.000 --> 00:00:00.320] And',
  '[00:00:00.320 --> 00:00:00.640] so',
  '[00:00:00.640 --> 00:00:00.960] my',
  '[00:00:00.960 --> 00:00:01.400] fellow',
  '[00:00:01.400 --> 00:00:02.100] Americans',
].join('\n');

describe('save_transcription file creation and frontmatter', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('saves transcription with metadata and timestamped words', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const audioBasename = path.basename(MOCK_AUDIO_PATH);
    const savedPath = (await save_transcription.execute(
      {
        filePath: 'transcripts/test.transcription.txt',
        sourceFile: MOCK_AUDIO_PATH,
        duration: SAMPLE_DURATION,
        content: SAMPLE_BODY_LINES,
      },
      testContext,
    )) as string;

    expect(savedPath).toBe(EXPECTED_SAVED_PATH);
    const savedContent = fs.readFileSync(EXPECTED_SAVED_PATH, 'utf8');
    expect(savedContent).toBe(`---\nsource_file: ${audioBasename}\nduration: ${SAMPLE_DURATION}\n---\n\n${SAMPLE_BODY_LINES}`);
    expect(stripTranscriptionMetadata(savedContent)).toBe(SAMPLE_BODY_LINES);
    expect(savedContent.replace(TRANSCRIPTION_METADATA_REGEX, '')).toBe(SAMPLE_BODY_LINES);

    const parsedMatter = matter(savedContent);
    expect(parsedMatter.data).toEqual({ source_file: audioBasename, duration: SAMPLE_DURATION });
    for (const row of parsedMatter.content.trim().split('\n')) {
      expect(row).toMatch(WORD_LINE_REGEX);
    }
  });

  test('auto-appends .txt extension and preserves existing frontmatter', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const audioBasename = path.basename(MOCK_AUDIO_PATH);
    const autoExtensionBody = '[00:00:03.000 --> 00:00:03.400] ask\n[00:00:03.400 --> 00:00:03.800] not';
    const autoExtensionPath = (await save_transcription.execute(
      {
        filePath: 'mock-notes',
        content: `---\nsource_file: "${audioBasename}"\nduration: '${SAMPLE_DURATION}'\n---\n\n${autoExtensionBody}`,
      },
      testContext,
    )) as string;

    expect(autoExtensionPath).toBe(EXPECTED_AUTO_EXTENSION_PATH);
    expect(fs.readFileSync(EXPECTED_AUTO_EXTENSION_PATH, 'utf8')).toBe(
      `---\nsource_file: ${audioBasename}\nduration: ${SAMPLE_DURATION}\n---\n\n${autoExtensionBody}`,
    );
  });
});

describe('save_transcription header conversion', () => {
  test('converts raw transcribe header format into frontmatter block', () => {
    const formatted = formatTranscriptionWithMetadata({
      content:
        'Filename: sample.mp4\nFile type: video/mp4\nDuration: 00:01:05.000 (65.00s)\n\n[00:00:00.000 --> 00:00:00.500] Spoken\n[00:00:00.500 --> 00:00:01.000] video',
    });
    expect(formatted).toBe(
      '---\nsource_file: sample.mp4\nduration: 00:01:05.000 (65.00s)\n---\n\n[00:00:00.000 --> 00:00:00.500] Spoken\n[00:00:00.500 --> 00:00:01.000] video',
    );
  });

  test('rejects empty transcription body in content', () => {
    const audioBasename = path.basename(MOCK_AUDIO_PATH);
    expect(() =>
      formatTranscriptionWithMetadata({
        content: `---\nsource_file: ${audioBasename}\nduration: ${SAMPLE_DURATION}\n---\n   `,
      }),
    ).toThrow(/Missing or empty transcription body in 'content'[\s\S]*Hint:/);
  });
});

describe('save_transcription format validation', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('rejects plain prose and multi-word rows without valid timestamp tokens', () => {
    const audioBasename = path.basename(MOCK_AUDIO_PATH);
    expect(() =>
      saveTranscriptionFile({
        filePath: 'plain-prose.txt',
        sourceFile: audioBasename,
        duration: SAMPLE_DURATION,
        content: 'And so my fellow Americans, ask not what your country can do for you.',
        directory: TEST_ROOT,
      }),
    ).toThrow(/Invalid transcription body format at line 1[\s\S]*sequence of timestamped words[\s\S]*Hint:/);

    expect(() =>
      saveTranscriptionFile({
        filePath: 'multi-word-row.txt',
        sourceFile: audioBasename,
        duration: SAMPLE_DURATION,
        content: '[00:00:00.000 --> 00:00:02.000] And so my fellow Americans',
        directory: TEST_ROOT,
      }),
    ).toThrow(/Invalid transcription body format at line 1[\s\S]*sequence of timestamped words[\s\S]*Hint:/);
  });

  test('rejects missing metadata arguments when frontmatter is absent', () => {
    const audioBasename = path.basename(MOCK_AUDIO_PATH);
    expect(() =>
      saveTranscriptionFile({
        filePath: 'missing-source.txt',
        content: '[00:00:00.000 --> 00:00:00.500] Hello',
        directory: TEST_ROOT,
      }),
    ).toThrow(/Missing required source file metadata \('sourceFile'\)[\s\S]*Hint:/);

    expect(() =>
      saveTranscriptionFile({
        filePath: 'missing-duration.txt',
        sourceFile: audioBasename,
        content: '[00:00:00.000 --> 00:00:00.500] Hello',
        directory: TEST_ROOT,
      }),
    ).toThrow(/Missing required audio\/video duration metadata \('duration'\)[\s\S]*Hint:/);
  });
});

describe('save_transcription collision and extension security', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('rejects overwriting an existing file', async () => {
    const testContext = createTestContext(TEST_ROOT);
    const audioBasename = path.basename(MOCK_AUDIO_PATH);
    const destinationPath = path.join(TEST_ROOT, 'existing-notes.txt');
    fs.writeFileSync(destinationPath, 'pre-existing content');

    await expect(
      save_transcription.execute(
        {
          filePath: 'existing-notes.txt',
          sourceFile: audioBasename,
          duration: SAMPLE_DURATION,
          content: '[00:00:00.000 --> 00:00:00.500] Modified',
        },
        testContext,
      ),
    ).rejects.toThrow(/Transcription file already exists:[\s\S]*Hint:/);
  });

  test('rejects invalid file extension and path traversal', () => {
    expect(() =>
      saveTranscriptionFile({
        filePath: 'malicious.js',
        content: "console.log('nope');",
        directory: TEST_ROOT,
      }),
    ).toThrow(/Invalid transcription file extension "\.js"[\s\S]*Only "\.txt" transcription files are allowed[\s\S]*Hint:/);

    expect(() =>
      saveTranscriptionFile({
        filePath: '../outside.txt',
        content: 'escaped',
        directory: TEST_ROOT,
      }),
    ).toThrow(/outside the working directory[\s\S]*Hint:/);
  });
});

describe('save_transcription boundary and input security', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('rejects absolute paths outside working directory and hidden files', () => {
    const outsideWorkingDirectory = path.resolve(TEST_ROOT, '..', `outside-work-dir-${process.pid}.txt`);
    expect(() =>
      saveTranscriptionFile({
        filePath: outsideWorkingDirectory,
        content: 'escaped',
        directory: TEST_ROOT,
      }),
    ).toThrow(/outside the working directory[\s\S]*Hint:/);

    expect(() =>
      saveTranscriptionFile({
        filePath: '.env',
        content: 'SECRET=1',
        directory: TEST_ROOT,
      }),
    ).toThrow(/cannot target hidden files or directories[\s\S]*Hint:/);
  });

  test('rejects blank filePath and empty content', () => {
    expect(() =>
      saveTranscriptionFile({
        filePath: THREE_SPACES,
        content: 'valid content',
        directory: TEST_ROOT,
      }),
    ).toThrow(/Missing required 'filePath' argument[\s\S]*Hint:/);

    expect(() =>
      saveTranscriptionFile({
        filePath: 'valid.txt',
        content: THREE_SPACES,
        directory: TEST_ROOT,
      }),
    ).toThrow(/Missing or empty 'content' argument[\s\S]*Hint:/);
  });
});
