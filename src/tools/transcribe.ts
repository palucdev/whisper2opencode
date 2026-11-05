import { tool } from '@opencode-ai/plugin';
import { transcribeAudioFile } from '../utils/transcribe.js';

export const transcribe = tool({
  description:
    'Transcribe audio, voice, or video files (.wav, .mp3, .m4a, .ogg, .flac, .webm, .mp4, .mkv, .mov, .avi, .pcmf32) into a timestamped list of spoken words ([HH:MM:SS.mmm --> HH:MM:SS.mmm] word) with file metadata (filename, file type, overall soundtrack duration) using whisper.cpp. For video files, automatically isolates the audio track before transcription. Always use this tool instead of read or bash when the user references an audio or video file. Run this tool once per file and search the returned transcript for words, phrases, or timestamps instead of transcribing the file multiple times.',
  args: {
    filePath: tool.schema.string().describe('Path to the audio or video file to transcribe'),
    language: tool.schema.string().optional().describe("Language code for transcription (default: 'en')"),
    modelPath: tool.schema.string().optional().describe('Optional path to a local whisper.cpp GGML .bin model file'),
  },
  async execute(args, context) {
    return transcribeAudioFile({
      filePath: args.filePath,
      language: args.language,
      modelPath: args.modelPath,
      directory: context.directory,
    });
  },
});
