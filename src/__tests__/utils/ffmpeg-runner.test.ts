import { afterEach, describe, expect, test } from 'bun:test';

import '../mock-ffmpeg.js';

import { buildConvertArguments, formatFfmpegStderr, getFfmpegBinary } from '../../utils/ffmpeg-runner.js';

const environmentSource = Reflect.get(process, 'env') as Record<string, string | undefined>;
const originalFfmpegPath = environmentSource.FFMPEG_PATH;

const setFfmpegPath = (value?: string): void => {
  if (value === undefined) {
    Reflect.deleteProperty(environmentSource, 'FFMPEG_PATH');
  } else {
    Reflect.set(environmentSource, 'FFMPEG_PATH', value);
  }
};

afterEach(() => {
  setFfmpegPath(originalFfmpegPath);
});

describe('getFfmpegBinary', () => {
  test('resolves the default, override, and environment binaries', () => {
    setFfmpegPath();
    expect(getFfmpegBinary()).toBe('/mock/bin/ffmpeg');
    expect(getFfmpegBinary('/custom/ffmpeg')).toBe('/custom/ffmpeg');

    setFfmpegPath('/env/ffmpeg');
    expect(getFfmpegBinary()).toBe('/env/ffmpeg');
  });

  test('throws an actionable error when ffmpeg cannot be found', () => {
    expect(() => getFfmpegBinary('')).toThrow(/'ffmpeg' is required/);
    expect(() =>
      getFfmpegBinary(undefined, () => {
        throw new Error('missing module');
      }),
    ).toThrow(/'ffmpeg' is required/);
  });
});

describe('formatFfmpegStderr', () => {
  test('keeps the last error lines and handles non-error values', () => {
    const error = Object.assign(new Error('ffmpeg failed'), { stderr: Buffer.from('line1\nline2\nline3\nline4') });
    expect(formatFfmpegStderr(error)).toEqual({ raw: 'line1\nline2\nline3\nline4', detail: 'line2 | line3 | line4' });
    expect(formatFfmpegStderr('plain failure')).toEqual({ raw: 'plain failure', detail: 'plain failure' });
  });
});

describe('buildConvertArguments', () => {
  test('builds format-specific ffmpeg arguments', () => {
    const pcmArguments = buildConvertArguments(
      { inputPath: 'in.wav', format: 'pcmf32', overwrite: false },
      { resolvedInputPath: 'in.wav', resolvedOutputPath: 'out.pcmf32' },
    );
    expect(pcmArguments).toContain('-n');
    expect(pcmArguments).toEqual(expect.arrayContaining(['-f', 'f32le', '-acodec', 'pcm_f32le']));
    expect(pcmArguments.at(-1)).toBe('out.pcmf32');

    const wavArguments = buildConvertArguments(
      { inputPath: 'in.mp3', format: 'wav', sampleRate: 8000, channels: 2 },
      { resolvedInputPath: 'in.mp3', resolvedOutputPath: 'out.wav' },
    );
    expect(wavArguments).toEqual(expect.arrayContaining(['-ar', '8000', '-ac', '2', '-c:a', 'pcm_s16le']));
  });
});
