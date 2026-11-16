import { describe, expect, test } from 'bun:test';

import '../mock-ffmpeg.js';
import '../mock-whisper.js';

import { transcribe } from '../../tools/transcribe.js';
import { MOCK_AUDIO_PATH, MOCK_MODEL_PATH, createTestContext } from '../fixtures.js';

describe('transcribe tool', () => {
  test('returns timestamped transcription output for audio files', async () => {
    const output = (await transcribe.execute(
      { filePath: MOCK_AUDIO_PATH, language: 'en', modelPath: MOCK_MODEL_PATH },
      createTestContext(),
    )) as string;

    expect(output).toStartWith('Filename: mock-audio.wav');
    expect(output).toContain('File type: audio/wav');
    expect(output).toContain('fellow');
  });

  test('rejects media files that do not exist', async () => {
    await expect(transcribe.execute({ filePath: 'missing.mp3' }, createTestContext())).rejects.toThrow(/not found/);
  });
});
