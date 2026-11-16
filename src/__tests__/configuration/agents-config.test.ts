import { describe, expect, spyOn, test } from 'bun:test';

import { configureAgents } from '../../configuration/agents-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

const mockAgentFiles = [
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
  { data: { description: 'No name' }, content: 'Nameless prompt' },
];

describe('configureAgents', () => {
  test('registers bundled agents and applies transcribe restrictions', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    expect(config.tools?.transcribe).toBe(false);
    expect(config.permission?.transcribe).toBe('deny');
    expect(config.agent.transcriber?.mode).toBe('subagent');
    expect(config.agent.transcriber?.tools?.transcribe).toBe(true);
    expect(config.agent.transcriber?.permission?.transcribe).toBe('allow');
  });

  test('preserves user-configured agents and settings', () => {
    const customAgent = { prompt: 'custom agent prompt' };
    const config = {
      agent: { transcriber: customAgent },
      tools: { transcribe: true },
      permission: { transcribe: 'ask' },
    } as unknown as OpenCodeConfig;

    configureAgents(config);

    expect(config.agent.transcriber).toBe(customAgent);
    expect(config.tools?.transcribe).toBe(true);
    expect(config.permission?.transcribe).toBe('ask');
  });

  test('parses markdown metadata and skips files without a name', () => {
    const loadSpy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue(
      mockAgentFiles as unknown as ReturnType<typeof fileUtility.loadMarkdownDirectory>,
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
      expect(Object.keys(config.agent)).toEqual(['agent-full']);
    } finally {
      loadSpy.mockRestore();
    }
  });
});
