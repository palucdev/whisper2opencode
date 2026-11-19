import { describe, expect, spyOn, test } from 'bun:test';

import { configureCommands } from '../../configuration/commands-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

describe('configureCommands', () => {
  test('registers the bundled transcribe command', () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(config.command.transcribe?.description).toContain('Transcribe an audio or video file');
    expect(config.command.transcribe?.template).toContain('"$ARGUMENTS"');
  });

  test('does not overwrite a user-configured command', () => {
    const customCommand = { template: 'custom template', description: 'custom description' };
    const config = { command: { transcribe: customCommand } } as unknown as OpenCodeConfig;

    configureCommands(config);

    expect(config.command.transcribe).toEqual(customCommand);
  });

  test('parses command metadata and skips files without a name', () => {
    const mockFiles = [
      {
        data: { name: 'cmd-full', description: 'Full description', agent: 'transcriber', model: 'fast', subtask: 'true' },
        content: 'Full command body',
      },
      { data: { description: 'No name' }, content: 'No name body' },
    ];
    const loadSpy = spyOn(fileUtility, 'loadMarkdownDirectory').mockReturnValue(
      mockFiles as unknown as ReturnType<typeof fileUtility.loadMarkdownDirectory>,
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
      expect(Object.keys(config.command)).toEqual(['cmd-full']);
    } finally {
      loadSpy.mockRestore();
    }
  });
});
