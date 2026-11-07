import type matter from 'gray-matter';
import type { OpenCodeConfig } from '../types/opencode-types.js';
import { loadMarkdownDir } from '../utils/file-util.js';

const prepareAgent = ({ data, content }: matter.GrayMatterFile<string>) => {
  return {
    prompt: content.trim(),
    ...(data.description && { description: data.description }),
    ...(data.model && data.model !== 'inherit' && { model: data.model }),
    ...(data.mode && { mode: data.mode }),
    ...(data.tools && { tools: data.tools }),
    ...(data.permission && { permission: data.permission }),
    ...((data.hidden === 'true' || data.hidden === true) && { hidden: true }),
  };
};

export const configureAgents = (config: OpenCodeConfig): void => {
  if (!config || typeof config !== 'object') return;
  config.agent = config.agent || {};
  config.tools = config.tools || {};
  if (config.tools.transcribe === undefined) {
    config.tools.transcribe = false;
  }
  config.permission = config.permission || {};
  if (config.permission.transcribe === undefined) {
    config.permission.transcribe = 'deny';
  }
  for (const markdown of loadMarkdownDir('agents')) {
    const name = markdown.data.name;
    if (!name) continue;
    // Don't overwrite agents the user has explicitly configured
    if (config.agent[name]) continue;

    try {
      config.agent[name] = prepareAgent(markdown);
    } catch (error) {
      console.warn(`[whisper2opencode] Failed to register agent '${name}': ${(error as Error).message}`);
    }
  }
};
