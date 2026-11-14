import path from 'node:path';
import type { SaveTranscriptionOptions } from '../types/whisper-types.js';
import { fileSystem } from './file-system.js';
import { formatTranscriptionWithMetadata } from './transcription-formatter.js';

const validatePathSegments = (relativeToBase: string, candidatePath: string): void => {
  const segments = relativeToBase.split(/[/\\]/);
  if (segments.some((segment) => segment.startsWith('.'))) {
    throw new Error(
      `Output path "${candidatePath}" cannot target hidden files or directories. Hint: Provide a standard '.txt' filename inside the working directory.`,
    );
  }
};

const resolveOutputTxtPath = (candidatePath: string): string => {
  const extension = path.extname(candidatePath);
  if (extension === '') {
    return `${candidatePath}.txt`;
  }
  if (extension.toLowerCase() === '.txt') {
    return candidatePath;
  }
  throw new Error(
    `Invalid transcription file extension "${extension}" for "${candidatePath}". Only ".txt" transcription files are allowed. Hint: Use a ".txt" file extension (e.g. "${path.basename(candidatePath, extension)}.txt").`,
  );
};

export const validateTranscriptionDestination = (baseDirectory: string, rawFilePath: string | undefined): string => {
  const trimmedPath = rawFilePath?.trim();
  if (!trimmedPath) {
    throw new Error(
      "Missing required 'filePath' argument. Hint: Provide a relative '.txt' file path inside the working directory (e.g. 'transcription.txt').",
    );
  }

  const candidatePath = path.isAbsolute(trimmedPath) ? path.resolve(trimmedPath) : path.resolve(baseDirectory, trimmedPath);
  const relativeToBase = path.relative(baseDirectory, candidatePath);
  if (!relativeToBase || relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    throw new Error(
      `Output path "${candidatePath}" is outside the working directory "${baseDirectory}". Hint: Provide a relative '.txt' file path inside the current working directory without '..' traversal.`,
    );
  }

  validatePathSegments(relativeToBase, candidatePath);
  const resolvedOutputPath = resolveOutputTxtPath(candidatePath);

  if (fileSystem.existsSync(resolvedOutputPath)) {
    throw new Error(
      `Transcription file already exists: ${resolvedOutputPath}. Existing files cannot be modified or overwritten. Hint: Choose a new, non-existent '.txt' filename within the working directory.`,
    );
  }

  return resolvedOutputPath;
};

export function saveTranscriptionFile(options: SaveTranscriptionOptions): string {
  const baseDirectory = path.resolve(options.directory ?? process.cwd());
  if (typeof options.content !== 'string' || !options.content.trim()) {
    throw new Error("Missing or empty 'content' argument. Hint: Provide the non-empty transcription text to save.");
  }

  const resolvedOutputPath = validateTranscriptionDestination(baseDirectory, options.filePath);
  const formattedContent = formatTranscriptionWithMetadata({
    content: options.content,
    sourceFile: options.sourceFile,
    duration: options.duration,
  });

  fileSystem.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fileSystem.writeFileSync(resolvedOutputPath, formattedContent, {
    encoding: 'utf8',
    flag: 'wx',
  });

  return resolvedOutputPath;
}
