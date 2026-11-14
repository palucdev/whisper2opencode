import type matter from 'gray-matter';
import type { OpenCodeAgentConfig, OpenCodeConfig } from '../types/opencode-types.js';
import { loadMarkdownDirectory } from '../utils/file-utility.js';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const buildAgentMetadata = (data: Record<string, unknown>): Partial<OpenCodeAgentConfig> => {
  const metadata: Partial<OpenCodeAgentConfig> = {};
  if (typeof data.description === 'string') metadata.description = data.description;
  if (typeof data.model === 'string' && data.model !== 'inherit') metadata.model = data.model;
  if (typeof data.mode === 'string') metadata.mode = data.mode;
  if (isRecord(data.tools)) metadata.tools = data.tools as Record<string, boolean>;
  if (isRecord(data.permission)) metadata.permission = data.permission as Record<string, string>;
  if (data.hidden === 'true' || data.hidden === true) metadata.hidden = true;
  return metadata;
};

const prepareAgent = ({ data, content }: matter.GrayMatterFile<string>): OpenCodeAgentConfig => ({
  prompt: content.trim(),
  ...buildAgentMetadata(data),
});

const initializeDefaults = (config: OpenCodeConfig): void => {
  config.agent ||= {};
  config.tools ||= {};
  config.tools.transcribe ??= false;
  config.permission ||= {};
  config.permission.transcribe ??= 'deny';
};

const registerAgent = (config: OpenCodeConfig, markdown: matter.GrayMatterFile<string>): void => {
  const rawName = markdown.data?.name;
  const name = typeof rawName === 'string' ? rawName : undefined;
  if (!name || Object.hasOwn(config.agent, name)) return;

  try {
    Reflect.set(config.agent, name, prepareAgent(markdown));
  } catch (error) {
    console.warn(`[whisper2opencode] Failed to register agent '${name}': ${(error as Error).message}`);
  }
};

export const configureAgents = (config: OpenCodeConfig): void => {
  if (!config || typeof config !== 'object') return;
  initializeDefaults(config);
  for (const markdown of loadMarkdownDirectory('agents')) {
    registerAgent(config, markdown);
  }
};
