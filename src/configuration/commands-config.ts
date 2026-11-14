import type { OpenCodeCommand, OpenCodeConfig } from '../types/opencode-types.js';
import { loadMarkdownDirectory } from '../utils/file-utility.js';

const parseSubtask = (rawSubtask: unknown): boolean | undefined =>
  rawSubtask === undefined ? undefined : rawSubtask === 'true' || rawSubtask === true;

const buildCommand = (data: Record<string, unknown>, content: string): OpenCodeCommand => {
  const subtask = parseSubtask(data.subtask);
  return {
    template: content.trim(),
    ...(typeof data.description === 'string' && { description: data.description }),
    ...(typeof data.agent === 'string' && { agent: data.agent }),
    ...(typeof data.model === 'string' && { model: data.model }),
    ...(subtask !== undefined && { subtask }),
  };
};

export const configureCommands = (config: OpenCodeConfig): void => {
  if (!config || typeof config !== 'object') return;
  config.command ||= {};
  for (const { data, content } of loadMarkdownDirectory('commands')) {
    const name = typeof data.name === 'string' ? data.name : undefined;
    // Don't overwrite commands the user has explicitly configured
    if (!name || Object.hasOwn(config.command, name)) continue;
    Reflect.set(config.command, name, buildCommand(data, content));
  }
};
