import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './plugin-info.js';

export const loadMarkdownDirectory = (directoryPath: string): matter.GrayMatterFile<string>[] => {
  const normalizedPath = path.resolve(PLUGIN_ROOT, directoryPath);
  let fileNames: string[];
  try {
    fileNames = fs.readdirSync(normalizedPath).filter((fileName) => fileName.endsWith('.md'));
  } catch {
    return [];
  }
  const parsed: matter.GrayMatterFile<string>[] = [];
  for (const fileName of fileNames) {
    try {
      const raw = fs.readFileSync(path.join(normalizedPath, fileName), 'utf8');
      parsed.push(matter(raw));
    } catch (error) {
      console.warn(
        `[whisper2opencode] Skipping unparseable markdown file ${fileName} in ${directoryPath}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return parsed;
};
