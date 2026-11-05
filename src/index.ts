/**
 * Whisper2OpenCode Plugin
 * Registers transcription tools and agents via OpenCode's JS event system.
 */

import type { Plugin } from "@opencode-ai/plugin";

import { PLUGIN_VERSION } from "./utils/plugin-info.js";
import type { OpenCodeConfig } from "./types/opencode-types.js";
import { transcribe } from "./tools/transcribe.js";
import { convert_audio } from "./tools/convert_audio.js";
import { configureAgents } from "./configuration/agents-config.js";

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling

const WhisperPlugin: Plugin = async () => {
  return {
    tool: {
      transcribe,
      convert_audio,
    },
    /**
     * Register whisper2opencode's agents so OpenCode discovers
     * them without requiring manual config file edits.
     */
    config: async (config: unknown) => {
      console.log(
        `[whisper2opencode] Starting plugin installation (v${PLUGIN_VERSION})...`,
      );
      let typedConfig = config as OpenCodeConfig;

      configureAgents(typedConfig);

      config = typedConfig;
      console.log(
        `[whisper2opencode] Plugin installation completed successfully (v${PLUGIN_VERSION}).`,
      );
    },
  };
};

export default WhisperPlugin;
