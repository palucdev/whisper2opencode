import { describe, expect, test } from 'bun:test';
import { formatMsToTimestamp, formatWordLines, parseTimestampToMs, stripTranscriptionMetadata } from '../../utils/transcription-formatter.js';

const MOCK_START_MS = 1000;
const MOCK_END_MS = 2000;
const EXPECTED_PARSED_MS = 83_456;
const NEGATIVE_TEST_MS = -100;

describe('transcription-formatter timestamp utilities', () => {
  test('parseTimestampToMs parses valid timestamps and returns zero for invalid format', () => {
    expect(parseTimestampToMs('00:01:23.456')).toBe(EXPECTED_PARSED_MS);
    expect(parseTimestampToMs('invalid-timestamp')).toBe(0);
  });

  test('formatMsToTimestamp formats milliseconds to HH:MM:SS.mmm and clamps negative values', () => {
    expect(formatMsToTimestamp(EXPECTED_PARSED_MS)).toBe('00:01:23.456');
    expect(formatMsToTimestamp(NEGATIVE_TEST_MS)).toBe('00:00:00.000');
  });
});

describe('transcription-formatter word line formatting', () => {
  test('formatWordLines extracts words with punctuation trimming and ignores brackets', () => {
    const segments = [
      {
        start: '00:00:01.000',
        end: '00:00:02.000',
        startMs: MOCK_START_MS,
        endMs: MOCK_END_MS,
        text: ' Hello, (world)! [whisper] ',
      },
    ];

    const lines = formatWordLines(segments);
    expect(lines).toEqual(['[00:00:01.037 --> 00:00:01.259] Hello', '[00:00:01.296 --> 00:00:01.593] world']);
  });

  test('stripTranscriptionMetadata handles content without metadata', () => {
    const plainText = '[00:00:00.000 --> 00:00:01.000] Test';
    expect(stripTranscriptionMetadata(plainText)).toBe(plainText);
  });
});
