import { describe, expect, test } from 'bun:test';

import { getEnvironmentConfig } from '../../utils/environment-config.js';

describe('getEnvironmentConfig', () => {
  test('reads ffmpeg and whisper model paths from the environment source', () => {
    expect(getEnvironmentConfig({ FFMPEG_PATH: '/usr/bin/ffmpeg', WHISPER_MODEL_PATH: '/models/model.bin' })).toEqual({
      ffmpegPath: '/usr/bin/ffmpeg',
      whisperModelPath: '/models/model.bin',
    });
    expect(getEnvironmentConfig({})).toEqual({ ffmpegPath: undefined, whisperModelPath: undefined });
  });
});
