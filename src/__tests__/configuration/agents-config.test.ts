import { describe, expect, spyOn, test } from 'bun:test';

import { configureAgents } from '../../configuration/agents-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

describe('configureAgents initialization and tools', () => {
  test('initializes config.agent object when agent is undefined', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    expect(config.agent).toBeDefined();
    expect(typeof config.agent).toBe('object');
  });

  test('safely handles undefined config without throwing', () => {
    expect(() => configureAgents(undefined as unknown as OpenCodeConfig)).not.toThrow();
  });

  test('populates config.agent with markdown files and restricts transcribe tool', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    expect(Object.keys(config.agent).length).toBeGreaterThan(0);
    expect(config.tools?.transcribe).toBe(false);
    expect(config.permission?.transcribe).toBe('deny');
    expect(config.agent.transcriber).toBeDefined();
    expect(config.agent.transcriber.mode).toBe('subagent');
    expect(config.agent.transcriber.tools?.transcribe).toBe(true);
    expect(config.agent.transcriber.permission?.transcribe).toBe('allow');
    expect(config.agent.transcriber.prompt).toContain('source_file:');
    expect(config.agent.transcriber.prompt).toContain('duration:');
    expect(config.agent.transcriber.prompt).toContain('sequence of timestamped words');
    expect(config.agent.transcriber.prompt).toContain('coherent sentences/passages');
    expect(config.agent.transcriber.prompt).toContain('Check the saved transcription file');
  });

  test('preserves existing user-configured tools.transcribe and permission.transcribe settings', () => {
    const config = {
      tools: { transcribe: true },
      permission: { transcribe: 'ask' },
    } as unknown as OpenCodeConfig;

    configureAgents(config);

    expect(config.tools?.transcribe).toBe(true);
    expect(config.permission?.transcribe).toBe('ask');
  });
});

describe('configureAgents user overrides', () => {
  test('does not overwrite existing agent definitions configured by user', () => {
    const customAgent = {
      prompt: 'custom agent prompt',
      description: 'custom description',
    };
    const config = {
      agent: {
        'existing-agent': customAgent,
      },
    } as unknown as OpenCodeConfig;

    const mockFiles = [
      {
        data: { name: 'existing-agent', description: 'should be ignored' },
        content: 'new prompt',
      },
      {
        data: { name: 'new-agent', description: 'new agent desc' },
        content: 'new agent prompt',
      },
    ];

    const spy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue(
      mockFiles as unknown as ReturnType<typeof fileUtility.loadMarkdownDirectory>,
    );

    try {
      configureAgents(config);

      expect(config.agent['existing-agent']).toEqual(customAgent);
      expect(config.agent['new-agent']).toEqual({
        prompt: 'new agent prompt',
        description: 'new agent desc',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('configureAgents skipped records', () => {
  test('skips markdown files missing a name field', () => {
    const mockFiles = [
      {
        data: { description: 'No name agent' },
        content: 'Prompt without name',
      },
    ];

    const spy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue(
      mockFiles as unknown as ReturnType<typeof fileUtility.loadMarkdownDirectory>,
    );

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(Object.keys(config.agent)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('configureAgents metadata parsing', () => {
  test('parses agent metadata including description, mode, model, hidden flag, tools, and permissions', () => {
    const mockMarkdownFiles = [
      {
        data: {
          name: 'agent-full',
          description: 'Full agent description',
          mode: 'subtask',
          hidden: 'true',
          model: 'gpt-4o',
          tools: { transcribe: true },
          permission: { transcribe: 'allow' },
        },
        content: 'Agent full prompt',
      },
      {
        data: {
          name: 'agent-minimal',
          hidden: false,
          model: 'inherit',
        },
        content: 'Minimal prompt',
      },
    ];

    const spy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue(
      mockMarkdownFiles as unknown as ReturnType<typeof fileUtility.loadMarkdownDirectory>,
    );

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(config.agent['agent-full']).toEqual({
        prompt: 'Agent full prompt',
        description: 'Full agent description',
        mode: 'subtask',
        hidden: true,
        model: 'gpt-4o',
        tools: { transcribe: true },
        permission: { transcribe: 'allow' },
      });

      expect(config.agent['agent-minimal']).toEqual({
        prompt: 'Minimal prompt',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('configureAgents error handling', () => {
  test('catches and logs error if prepareAgent throws', () => {
    let accessCount = 0;
    const faultyMarkdown = {
      get data() {
        accessCount++;
        if (accessCount === 1) return { name: 'faulty-agent' };
        throw new Error('Second access error');
      },
      content: 'Faulty content',
    };

    const spy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue([faultyMarkdown] as unknown as ReturnType<
      typeof fileUtility.loadMarkdownDirectory
    >);
    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(config.agent['faulty-agent']).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith("[whisper2opencode] Failed to register agent 'faulty-agent': Second access error");
    } finally {
      spy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});
