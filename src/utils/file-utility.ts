import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(__dirname, '..');
const AGENTS_DIRECTORY = path.join(PLUGIN_ROOT, 'agents');
const COMMANDS_DIRECTORY = path.join(PLUGIN_ROOT, 'commands');

export type MarkdownDirectoryName = 'agents' | 'commands';

const filterMarkdownFiles = (fileNames: string[]): string[] => fileNames.filter((fileName) => fileName.endsWith('.md'));

const listAgentMarkdownFiles = (): string[] => {
  try {
    return filterMarkdownFiles(fs.readdirSync(AGENTS_DIRECTORY));
  } catch {
    return [];
  }
};

const listCommandMarkdownFiles = (): string[] => {
  try {
    return filterMarkdownFiles(fs.readdirSync(COMMANDS_DIRECTORY));
  } catch {
    return [];
  }
};

export const loadMarkdownDirectory = (directoryName: MarkdownDirectoryName): matter.GrayMatterFile<string>[] => {
  const fileNames = directoryName === 'agents' ? listAgentMarkdownFiles() : listCommandMarkdownFiles();
  const directoryPath = directoryName === 'agents' ? AGENTS_DIRECTORY : COMMANDS_DIRECTORY;

  const parsed: matter.GrayMatterFile<string>[] = [];
  for (const fileName of fileNames) {
    try {
      parsed.push(matter.read(path.join(directoryPath, fileName)));
    } catch (error) {
      console.warn(
        `[whisper2opencode] Skipping unparseable markdown file ${fileName} in ${directoryName}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return parsed;
};
