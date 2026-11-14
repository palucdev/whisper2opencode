import { describe, expect, test } from 'bun:test';
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureSkills } from '../../configuration/skills-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';

const pluginRootDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const expectedSkillsDirectory = path.join(pluginRootDirectory, 'skills');

describe('configureSkills initialization', () => {
  test('initializes skills and skills.paths when skills is undefined', () => {
    const config = {} as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills).toBeDefined();
    expect(config.skills.paths).toEqual([expectedSkillsDirectory]);
  });

  test('safely handles undefined config without throwing', () => {
    expect(() => configureSkills(undefined as unknown as OpenCodeConfig)).not.toThrow();
  });

  test('initializes skills.paths when skills object exists but skills.paths is undefined', () => {
    const config = { skills: {} } as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills.paths).toEqual([expectedSkillsDirectory]);
  });
});

describe('configureSkills paths mutation and skill content', () => {
  test('appends skills directory to existing paths list without modifying existing entries', () => {
    const existingPath = '/custom/skills/path';
    const config = {
      skills: {
        paths: [existingPath],
      },
    } as OpenCodeConfig;

    configureSkills(config);

    expect(config.skills.paths).toEqual([existingPath, expectedSkillsDirectory]);
  });

  test('does not add duplicate skills directory if it is already present in skills.paths', () => {
    const config = {
      skills: {
        paths: [expectedSkillsDirectory],
      },
    } as OpenCodeConfig;

    configureSkills(config);

    expect(config.skills.paths).toEqual([expectedSkillsDirectory]);
    expect(config.skills.paths).toHaveLength(1);
  });

  test('ships audio-video-transcription skill with valid frontmatter and subagent delegation instructions', () => {
    const skillPath = path.join(expectedSkillsDirectory, 'audio-video-transcription', 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);

    const parsed = matter(fs.readFileSync(skillPath, 'utf8'));
    expect(parsed.data.name).toBe('audio-video-transcription');
    expect(parsed.data.description).toContain('Audio and video transcription');
    expect(parsed.data.description).toContain('recording');
    expect(parsed.data.description).toContain('audio');
    expect(parsed.data.description).toContain('video');
    expect(parsed.data.description).toContain('transcriber');
    expect(parsed.content).toContain('subagent_type: "transcriber"');
    expect(parsed.content).toContain('source_file:');
    expect(parsed.content).toContain('duration:');
    expect(parsed.content).toContain('sequence of timestamped words');
    expect(parsed.content).toContain('coherent sentences/passages');
    expect(parsed.content).toContain('saved transcription');
  });
});
