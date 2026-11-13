import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as agentsConfig from '../configuration/agents-config.js';
import * as commandsConfig from '../configuration/commands-config.js';
import * as skillsConfig from '../configuration/skills-config.js';
import WhisperPlugin from '../index.js';
import { convert_audio } from '../tools/convert_audio.js';
import { download_whisper, download_whisper_cpp } from '../tools/download_whisper_cpp.js';
import { save_transcription } from '../tools/save_transcription.js';
import { transcribe } from '../tools/transcribe.js';

const mockPluginInput = (directory: string, client?: any) =>
  ({
    $: {} as any,
    directory,
    client: client ?? ({} as any),
    project: {} as any,
    worktree: directory,
    experimental_workspace: {} as any,
    serverUrl: new URL('http://localhost'),
  }) as any;

describe('WhisperPlugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper2opencode-index-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should export default plugin factory and register tools and config hook', async () => {
    const plugin = await WhisperPlugin(mockPluginInput(tmpDir));
    expect(plugin).toBeDefined();
    expect(plugin.tool?.transcribe).toBe(transcribe);
    expect(plugin.tool?.convert_audio).toBe(convert_audio);
    expect(plugin.tool?.save_transcription).toBe(save_transcription);
    expect(plugin.tool?.download_whisper_cpp).toBe(download_whisper_cpp);
    expect(plugin.tool?.download_whisper).toBe(download_whisper);
    expect(typeof plugin.config).toBe('function');
    expect(typeof plugin.dispose).toBe('function');
  });

  test('should work when invoked with empty / default arguments', async () => {
    const plugin = await WhisperPlugin();
    expect(plugin).toBeDefined();
    expect(typeof plugin.config).toBe('function');
  });

  describe('config hook', () => {
    test('should configure skills, commands, and agents from config', async () => {
      const skillsSpy = spyOn(skillsConfig, 'configureSkills').mockImplementation(() => {});
      const commandsSpy = spyOn(commandsConfig, 'configureCommands').mockImplementation(() => {});
      const agentsSpy = spyOn(agentsConfig, 'configureAgents').mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

      try {
        const plugin = await WhisperPlugin(mockPluginInput(tmpDir));
        const inputConfig = { agent: {}, command: {}, skills: {} };

        await plugin.config!(inputConfig as any);

        expect(skillsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(commandsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(agentsSpy).toHaveBeenCalledWith(inputConfig as any);
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe('dispose hook', () => {
    test('should execute dispose cleanly without error', async () => {
      const plugin = await WhisperPlugin(mockPluginInput(tmpDir));
      await expect(plugin.dispose?.()).resolves.toBeUndefined();
    });
  });
});
