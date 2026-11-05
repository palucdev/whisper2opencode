import { describe, expect, spyOn, test } from 'bun:test';

import { configureCommands } from '../../configuration/commands-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtil from '../../utils/file-util.js';

describe('configureCommands', () => {
  test('should initialize config.command and load commands from directory', () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(config.command).toBeDefined();
    expect(config.command.transcribe).toBeDefined();
    expect(config.command.transcribe!.description).toContain('Transcribe an audio or video file');
    expect(config.command.transcribe!.template).toContain('"$ARGUMENTS"');
  });

  test('should safely handle null/undefined config without throwing', () => {
    expect(() => configureCommands(null as any)).not.toThrow();
    expect(() => configureCommands(undefined as any)).not.toThrow();
  });

  test('should not overwrite an existing command configured by user', () => {
    const customCommand = {
      template: 'custom template',
      description: 'custom description',
    };
    const config = {
      command: {
        transcribe: customCommand,
      },
    } as unknown as OpenCodeConfig;

    configureCommands(config);

    expect(config.command.transcribe).toEqual(customCommand);
  });

  test('should parse command attributes including description, agent, model, and subtask', () => {
    const mockMarkdownFiles = [
      {
        data: {
          name: 'cmd-full',
          description: 'Full description',
          agent: 'transcriber',
          model: 'fast',
          subtask: 'true',
        },
        content: 'Full command body',
      },
      {
        data: {
          name: 'cmd-subtask-false',
          subtask: false,
        },
        content: 'Subtask false body',
      },
      {
        data: {
          // Missing name - should be skipped
          description: 'No name',
        },
        content: 'No name body',
      },
    ];

    const spy = spyOn(fileUtil, 'loadMarkdownDir').mockReturnValue(mockMarkdownFiles as any);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command['cmd-full']).toEqual({
        template: 'Full command body',
        description: 'Full description',
        agent: 'transcriber',
        model: 'fast',
        subtask: true,
      });

      expect(config.command['cmd-subtask-false']).toEqual({
        template: 'Subtask false body',
        subtask: false,
      });

      expect(config.command['undefined']).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
