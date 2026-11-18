import { describe, expect, test } from 'bun:test';
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';

import { configureSkills } from '../../configuration/skills-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import { PLUGIN_ROOT } from '../../utils/plugin-info.js';

const skillsDirectory = path.join(PLUGIN_ROOT, 'skills');

describe('configureSkills', () => {
  test('adds the bundled skills directory once', () => {
    const config = {} as OpenCodeConfig;
    configureSkills(config);
    configureSkills(config);

    expect(config.skills.paths).toEqual([skillsDirectory]);
  });

  test('preserves existing skill paths', () => {
    const config = { skills: { paths: ['/custom/skills'] } } as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills.paths).toEqual(['/custom/skills', skillsDirectory]);
  });

  test('ships a valid audio-video-transcription skill', () => {
    const skillPath = path.join(skillsDirectory, 'audio-video-transcription', 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);

    const parsed = matter(fs.readFileSync(skillPath, 'utf8'));
    expect(parsed.data.name).toBe('audio-video-transcription');
    expect(parsed.data.description).toContain('transcriber');
    expect(parsed.content).toContain('subagent_type: "transcriber"');
  });
});
