import { tool } from "@opencode-ai/plugin";
import { saveTranscriptionFile } from "../utils/transcribe.js";

export const save_transcription = tool({
  description:
    "Save a transcription text file (.txt) to the filesystem within the current working directory. Only creates new .txt files inside the working directory; never overwrites or modifies existing files, deletes files, or creates non-.txt files.",
  args: {
    filePath: tool.schema
      .string()
      .describe(
        "Relative path within the working directory for the new transcription .txt file (e.g. 'jfk.txt' or 'transcripts/jfk.transcription.txt'). Automatically appends '.txt' if no extension is given.",
      ),
    content: tool.schema
      .string()
      .describe("Non-empty transcription text content to save to the .txt file"),
  },
  async execute(args, context) {
    return saveTranscriptionFile({
      filePath: args.filePath,
      content: args.content,
      directory: context.directory,
    });
  },
});
