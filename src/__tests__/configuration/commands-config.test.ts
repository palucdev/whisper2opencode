import { describe, expect, spyOn, test } from 'bun:test';

import { configureCommands } from '../../configuration/commands-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

describe('configureCommands defaults and overrides', () => {
  test('initializes config.command and loads commands from directory', () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(config.command).toBeDefined();
    expect(config.command.transcribe).toBeDefined();
    expect(config.command.transcribe!.description).toContain('Transcribe an audio or video file');
    expect(config.command.transcribe!.template).toContain('"$ARGUMENTS"');
    expect(config.command.transcribe!.template).toContain('sequence of timestamped words');
    expect(config.command.transcribe!.template).toContain('coherent sentences/passages');
    expect(config.command.transcribe!.template).toContain('hint to check the saved transcription file');
  });

  test('safely handles undefined config without throwing', () => {
    expect(() => configureCommands(undefined as unknown as OpenCodeConfig)).not.toThrow();
  });

  test('does not overwrite an existing command configured by user', () => {
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
});

describe('configureCommands markdown attribute parsing', () => {
  test('parses command attributes including description, agent, model, and subtask', () => {
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
          description: 'No name',
        },
        content: 'No name body',
      },
    ];

    const spy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue(
      mockMarkdownFiles as unknown as ReturnType<typeof fileUtility.loadMarkdownDirectory>,
    );

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
