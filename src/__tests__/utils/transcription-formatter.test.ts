import { describe, expect, test } from 'bun:test';

import {
  extractMetadataAndBody,
  formatMsToTimestamp,
  formatTranscriptionWithMetadata,
  formatWordLines,
  parseTimestampToMs,
  stripTranscriptionMetadata,
} from '../../utils/transcription-formatter.js';

const VALID_BODY = '[00:00:00.000 --> 00:00:00.500] Hello\n[00:00:00.500 --> 00:00:01.000] world';
const PARSED_MILLISECONDS = 83_456;
const NEGATIVE_MILLISECONDS = -100;
const WHITESPACE_REPEAT_COUNT = 3;

describe('timestamp utilities', () => {
  test('parseTimestampToMs and formatMsToTimestamp round-trip timestamps', () => {
    expect(parseTimestampToMs('00:01:23.456')).toBe(PARSED_MILLISECONDS);
    expect(formatMsToTimestamp(PARSED_MILLISECONDS)).toBe('00:01:23.456');
    expect(parseTimestampToMs('invalid')).toBe(0);
    expect(formatMsToTimestamp(NEGATIVE_MILLISECONDS)).toBe('00:00:00.000');
  });
});

describe('formatWordLines', () => {
  test('produces one timestamped word per line and strips punctuation', () => {
    const lines = formatWordLines([
      {
        startMs: 1000,
        endMs: 2000,
        text: ' Hello, (world)! [whisper] ',
      },
    ]);

    expect(lines).toEqual(['[00:00:01.037 --> 00:00:01.259] Hello', '[00:00:01.296 --> 00:00:01.593] world']);
  });
});

describe('metadata handling', () => {
  test('extracts YAML frontmatter and raw transcribe headers', () => {
    expect(extractMetadataAndBody(`---\nsource_file: sample.wav\nduration: 1s\n---\n\n${VALID_BODY}`)).toEqual({
      sourceFile: 'sample.wav',
      duration: '1s',
      body: VALID_BODY,
    });

    expect(extractMetadataAndBody(`Filename: sample.mp4\nDuration: 00:01:05.000 (65.00s)\n\n${VALID_BODY}`)).toEqual({
      sourceFile: 'sample.mp4',
      duration: '00:01:05.000 (65.00s)',
      body: VALID_BODY,
    });
  });

  test('strips metadata blocks and leaves plain bodies untouched', () => {
    const content = `---\nsource_file: sample.wav\nduration: 1s\n---\n\n${VALID_BODY}`;
    expect(stripTranscriptionMetadata(content)).toBe(VALID_BODY);
    expect(stripTranscriptionMetadata(VALID_BODY)).toBe(VALID_BODY);
  });

  test('formats a normalized transcription with metadata', () => {
    const formatted = formatTranscriptionWithMetadata({
      content: `Filename: sample.mp4\nFile type: video/mp4\nDuration: 00:01:05.000 (65.00s)\n\n${VALID_BODY}`,
    });

    expect(formatted).toBe(`---\nsource_file: sample.mp4\nduration: 00:01:05.000 (65.00s)\n---\n\n${VALID_BODY}`);
  });

  test('rejects missing metadata and invalid word rows', () => {
    expect(() => formatTranscriptionWithMetadata({ content: VALID_BODY })).toThrow(/sourceFile/);
    expect(() => formatTranscriptionWithMetadata({ content: VALID_BODY, sourceFile: 'sample.wav' })).toThrow(/duration/);
    expect(() => formatTranscriptionWithMetadata({ content: 'plain prose', sourceFile: 'sample.wav', duration: '1s' })).toThrow(
      /Invalid transcription body format/,
    );
    expect(() => formatTranscriptionWithMetadata({ content: ' '.repeat(WHITESPACE_REPEAT_COUNT), sourceFile: 'sample.wav', duration: '1s' })).toThrow(
      /empty transcription body/,
    );
  });
});
