import { describe, expect, spyOn, test } from 'bun:test';
import type { Config } from '@opencode-ai/plugin';

import * as agentsConfig from '../configuration/agents-config.js';
import * as commandsConfig from '../configuration/commands-config.js';
import * as skillsConfig from '../configuration/skills-config.js';
import WhisperPlugin from '../index.js';
import { convert_audio } from '../tools/convert-audio.js';
import { download_whisper_cpp } from '../tools/download-whisper-cpp.js';
import { save_transcription } from '../tools/save-transcription.js';
import { transcribe } from '../tools/transcribe.js';
import type { OpenCodeConfig } from '../types/opencode-types.js';

describe('WhisperPlugin', () => {
  test('registers tools and lifecycle hooks', async () => {
    const plugin = await WhisperPlugin();

    expect(plugin.tool?.transcribe).toBe(transcribe);
    expect(plugin.tool?.convert_audio).toBe(convert_audio);
    expect(plugin.tool?.save_transcription).toBe(save_transcription);
    expect(plugin.tool?.download_whisper_cpp).toBe(download_whisper_cpp);
    expect(plugin.tool?.download_whisper).toBeUndefined();
    expect(typeof plugin.config).toBe('function');
    expect(typeof plugin.dispose).toBe('function');
  });

  test('config hook installs skills, commands, and agents', async () => {
    const skillsSpy = spyOn(skillsConfig, 'configureSkills').mockImplementation(() => {});
    const commandsSpy = spyOn(commandsConfig, 'configureCommands').mockImplementation(() => {});
    const agentsSpy = spyOn(agentsConfig, 'configureAgents').mockImplementation(() => {});
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      const plugin = await WhisperPlugin();
      const inputConfig: OpenCodeConfig = { agent: {}, command: {}, skills: {} };

      await plugin.config!(inputConfig as unknown as Config);

      expect(skillsSpy).toHaveBeenCalledWith(inputConfig);
      expect(commandsSpy).toHaveBeenCalledWith(inputConfig);
      expect(agentsSpy).toHaveBeenCalledWith(inputConfig);
    } finally {
      skillsSpy.mockRestore();
      commandsSpy.mockRestore();
      agentsSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });

  test('disposes cleanly', async () => {
    const plugin = await WhisperPlugin();
    await expect(plugin.dispose?.()).resolves.toBeUndefined();
  });
});
