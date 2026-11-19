# Whisper2OpenCode Agent Guidelines

This repository provides an OpenCode v1 plugin for audio and video transcription using `whisper.cpp` JS bindings and `ffmpeg-static`.

## Platform & Environment

- **Runtime**: [Bun](https://bun.sh/) >= 1.3
- **Language**: TypeScript (strict NodeNext/ESNext ESM)
- **Plugin Framework**: `@opencode-ai/plugin` v1
- **Testing**: `bun test src` with coverage thresholds configured in `bunfig.toml`
- **Formatting**: `bun run prettify` (Prettier, single quotes, 150 line width)

## Repository Structure

```
whisper2opencode/
├── scripts/
│   └── copy-markdowns.js       # Copies skills, agents, and commands to dist/
├── src/
│   ├── __tests__/              # TypeScript test suites (bun:test)
│   │   ├── configuration/      # Skill, agent, and command config tests
│   │   ├── utils/              # Audio, transcribe, file-util tests
│   │   ├── index.test.ts       # Plugin entry point tests
│   │   └── tsconfig.json       # Test compiler configuration
│   ├── agents/                 # Agent definitions and prompts (.md)
│   │   └── transcriber.md      # Specialized transcription subagent
│   ├── commands/               # Slash command definitions (.md)
│   │   └── transcribe.md       # /transcribe command
│   ├── configuration/          # Handlers for skill, agent, and command configs
│   ├── skills/                 # Orchestrator skill definitions (SKILL.md)
│   │   └── audio-video-transcription/
│   │       └── SKILL.md        # Skill enabling main agent orchestrators to use transcriber subagents
│   ├── tools/                  # OpenCode tool implementations
│   │   ├── convert_audio.ts    # Audio conversion and track extraction
│   │   ├── save_transcription.ts # Working-directory text file saver
│   │   └── transcribe.ts       # whisper.cpp transcription tool
│   ├── types/                  # TypeScript interfaces and hook types
│   ├── utils/                  # Core audio decoding, whisper runner, file utils
│   └── index.ts                # Main plugin entry point
├── bunfig.toml                 # Test coverage settings (80% threshold)
├── package.json
└── tsconfig.json
```

## Key Architectural Principles

1. **Single-Pass Transcription**: Agents must call `transcribe` once per file. All timestamp lookups, word searches, and analyses must be performed on the returned word list.
2. **Audio Track Isolation**: Video files automatically have their audio stream extracted via `ffmpeg-static`. `convert_audio` serves as a fallback for repairing corrupted or incompatible containers.
3. **Safe File Operations & Transcript Metadata**: `save_transcription` strictly creates new `.txt` files in the current working directory. It refuses to save when the target file already exists (a check-then-write guard), never creates non-`.txt` files, and never traverses outside `directory`. Every saved `.txt` file starts with a `---`-delimited YAML frontmatter metadata header (`source_file` and `duration`) separated by a blank line from the sequence of timestamped words (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] word`, one word per row) so transcript consumers can easily parse or strip it automatically. Subagents return reconstructed coherent sentences/passages to the main agent along with a hint to check the saved transcription file for word-level timestamp details.
4. **Clean Model Specification**: Agent definitions specify models directly without alias indirection.
5. **Fail-Safe Testing**: Tests live in `src/__tests__/`, test source files directly, and run via `bun test src`. Run `bun run type-check` and `bun test src` before committing.
