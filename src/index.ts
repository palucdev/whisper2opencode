/**
 * Whisper2OpenCode Plugin
 * Registers transcription tools, skills, commands, and agents via OpenCode's JS event system.
 */

import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';

import { configureAgents } from './configuration/agents-config.js';
import { configureCommands } from './configuration/commands-config.js';
import { configureSkills } from './configuration/skills-config.js';
import { convert_audio } from './tools/convert_audio.js';
import { save_transcription } from './tools/save_transcription.js';
import { transcribe } from './tools/transcribe.js';
import { HookEvent } from './types/hook-types.js';
import type { OpenCodeConfig } from './types/opencode-types.js';
import { PLUGIN_VERSION } from './utils/plugin-info.js';

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling

const WhisperPlugin = (async (input?: Partial<PluginInput>, options?: PluginOptions): Promise<Hooks> => {
  const hooks: Hooks = {
    tool: {
      transcribe,
      convert_audio,
      save_transcription,
    },
    /**
     * Register whisper2opencode's skills, commands, and agents so OpenCode discovers
     * them without requiring manual config file edits.
     */
    [HookEvent.Config]: async (config: unknown) => {
      console.log(`[whisper2opencode] Starting plugin installation (v${PLUGIN_VERSION})...`);
      const typedConfig = config as OpenCodeConfig;

      configureSkills(typedConfig);
      configureCommands(typedConfig);
      configureAgents(typedConfig);

      console.log(`[whisper2opencode] Plugin installation completed successfully (v${PLUGIN_VERSION}).`);
    },
    dispose: async () => {
      // Cleanup hooks when plugin instance is disposed
    },
  };

  return hooks;
}) satisfies Plugin;

export default WhisperPlugin;
