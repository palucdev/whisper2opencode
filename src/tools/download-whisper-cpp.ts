import { tool } from '@opencode-ai/plugin';
import { downloadWhisperSetup } from '../utils/download-whisper.js';

export const download_whisper_cpp = tool({
  description:
    'Download and set up whisper.cpp and speech recognition models for the current environment and setup (detects Bun, npm, pnpm, yarn). Automatically installs the whisper.cpp package and downloads the default GGML speech model into cache. Use this tool whenever transcription fails because whisper.cpp is missing, not found, or could not be loaded in your environment.',
  args: {
    packageManager: tool.schema
      .enum(['bun', 'npm', 'pnpm', 'yarn'])
      .optional()
      .describe("Package manager to use for installation (default: auto-detected based on project lockfile and runtime, e.g. 'bun' or 'npm')"),
    modelName: tool.schema
      .string()
      .optional()
      .describe(
        "GGML model name to download into cache (default: 'base.en', options include 'tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small')",
      ),
    skipModel: tool.schema.boolean().optional().describe('Whether to skip downloading the GGML speech model (default: false)'),
    directory: tool.schema.string().optional().describe('Target directory for installation (default: current working directory)'),
  },
  async execute(toolArguments, context) {
    const result = await downloadWhisperSetup({
      packageManager: toolArguments.packageManager,
      modelName: toolArguments.modelName,
      skipModel: toolArguments.skipModel,
      directory: toolArguments.directory ?? context.directory,
    });
    return result.summary;
  },
});
