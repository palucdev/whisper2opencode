import { tool } from '@opencode-ai/plugin';
import { saveTranscriptionFile } from '../utils/transcribe.js';

export const save_transcription = tool({
  description:
    'Save a transcription text file (.txt) to the filesystem within the current working directory. Prepends a YAML frontmatter metadata header (--- source_file and duration ---) at the beginning of the file, clearly separated from the transcript body by a blank line so transcript consumers can easily parse or strip it automatically. Only creates new .txt files inside the working directory; never overwrites or modifies existing files, deletes files, or creates non-.txt files.',
  args: {
    filePath: tool.schema
      .string()
      .describe(
        "Relative path within the working directory for the new transcription .txt file (e.g. 'jfk.txt' or 'transcripts/jfk.transcription.txt'). Automatically appends '.txt' if no extension is given.",
      ),
    sourceFile: tool.schema
      .string()
      .optional()
      .describe(
        "Name of the source audio or video file (e.g. 'jfk.wav' or 'interview.mp4') to write into the metadata header at the beginning of the transcript file.",
      ),
    duration: tool.schema
      .string()
      .optional()
      .describe(
        "Duration of the source audio or video (e.g. '00:00:11.000 (11.00s)') to write into the metadata header at the beginning of the transcript file.",
      ),
    content: tool.schema
      .string()
      .describe(
        'Non-empty transcription text content to save to the .txt file. May be plain transcript body text (when sourceFile and duration are provided) or already include the leading --- metadata --- header block.',
      ),
  },
  async execute(args, context) {
    return saveTranscriptionFile({
      filePath: args.filePath,
      content: args.content,
      sourceFile: args.sourceFile,
      duration: args.duration,
      directory: context.directory,
    });
  },
});
