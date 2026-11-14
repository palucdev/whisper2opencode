import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';

import * as agentsConfig from '../configuration/agents-config.js';
import * as commandsConfig from '../configuration/commands-config.js';
import * as skillsConfig from '../configuration/skills-config.js';
import WhisperPlugin from '../index.js';
import { convert_audio } from '../tools/convert-audio.js';
import { download_whisper, download_whisper_cpp } from '../tools/download-whisper-cpp.js';
import { save_transcription } from '../tools/save-transcription.js';
import { transcribe } from '../tools/transcribe.js';
import type { OpenCodeConfig } from '../types/opencode-types.js';

const TEST_ROOT = path.join(process.cwd(), 'node_modules', '.test-scratch', 'plugin-index');

const mockPluginInput = (): PluginInput =>
  ({
    directory: TEST_ROOT,
    worktree: TEST_ROOT,
    serverUrl: new URL('http://localhost'),
  }) as unknown as PluginInput;

describe('WhisperPlugin tool registration', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('exports default plugin factory and registers tools', async () => {
    const plugin = await WhisperPlugin(mockPluginInput());
    expect(plugin).toBeDefined();
    expect(plugin.tool?.transcribe).toBe(transcribe);
    expect(plugin.tool?.convert_audio).toBe(convert_audio);
    expect(plugin.tool?.save_transcription).toBe(save_transcription);
    expect(plugin.tool?.download_whisper_cpp).toBe(download_whisper_cpp);
    expect(plugin.tool?.download_whisper).toBe(download_whisper);
    expect(typeof plugin.config).toBe('function');
    expect(typeof plugin.dispose).toBe('function');
  });

  test('works when invoked with empty / default arguments', async () => {
    const plugin = await WhisperPlugin();
    expect(plugin).toBeDefined();
    expect(typeof plugin.config).toBe('function');
  });
});

describe('WhisperPlugin hooks', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test('configures skills, commands, and agents from config hook', async () => {
    const skillsSpy = spyOn(skillsConfig, 'configureSkills').mockImplementation(() => {});
    const commandsSpy = spyOn(commandsConfig, 'configureCommands').mockImplementation(() => {});
    const agentsSpy = spyOn(agentsConfig, 'configureAgents').mockImplementation(() => {});
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      const plugin = await WhisperPlugin(mockPluginInput());
      const inputConfig: OpenCodeConfig = { agent: {}, command: {}, skills: {} };

      await plugin.config!(inputConfig as unknown);

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

  test('executes dispose hook cleanly without error', async () => {
    const plugin = await WhisperPlugin(mockPluginInput());
    await expect(plugin.dispose?.()).resolves.toBeUndefined();
  });
});
