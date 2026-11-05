import { tool } from '@opencode-ai/plugin';
import { convertAudioFile } from '../utils/audio.js';

export const convert_audio = tool({
  description:
    'Convert audio or video files to a target audio format (.wav, .mp3, .ogg, .flac, .m4a, .pcmf32) using ffmpeg. Useful for extracting audio tracks from video files, normalizing sample rate/channels (e.g. 16kHz mono for speech recognition), or repairing incompatible containers.',
  args: {
    inputPath: tool.schema.string().describe('Path to the source audio or video file'),
    outputPath: tool.schema
      .string()
      .optional()
      .describe('Optional output file path. Defaults to the input filename with the target format extension in the same directory.'),
    format: tool.schema.enum(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'pcmf32']).optional().describe("Target audio format (default: 'wav')"),
    sampleRate: tool.schema.number().int().positive().optional().describe('Target sample rate in Hz (default: 16000)'),
    channels: tool.schema.number().int().min(1).max(2).optional().describe('Number of audio channels: 1 for mono, 2 for stereo (default: 1)'),
    overwrite: tool.schema.boolean().optional().describe('Whether to overwrite outputPath if it already exists (default: true)'),
  },
  async execute(args, context) {
    return convertAudioFile({
      inputPath: args.inputPath,
      outputPath: args.outputPath,
      format: args.format,
      sampleRate: args.sampleRate,
      channels: args.channels,
      overwrite: args.overwrite,
      directory: context.directory,
    });
  },
});
