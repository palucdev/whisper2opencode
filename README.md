# Whisper2OpenCode

**Fast, local audio and video transcription plugin for OpenCode using whisper.cpp and ffmpeg.**

Whisper2OpenCode extends [OpenCode](https://opencode.ai/) with speech-to-text capabilities powered by local `whisper.cpp` WebAssembly/C++ bindings and `ffmpeg-static`. Transcribe voice notes, meetings, interviews, screen recordings, and videos directly within your development workflows—complete with word-level timestamps, metadata, and automated spoken-content analysis.

---

## What You Get

- **High-Precision Transcription**: Word-level timestamps (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] word`) with full metadata (filename, format, soundtrack duration).
- **Video & Audio Track Isolation**: Automatic extraction of audio streams from video containers (`.mp4`, `.mkv`, `.mov`, `.webm`, `.avi`) via `ffmpeg-static`.
- **Orchestrator Transcription Skill**: Built-in `audio-video-transcription` skill enabling any main agent or external workflow orchestrator to delegate single-file or parallel multi-file transcription to `transcriber` subagents.
- **Transcriber Subagent**: Autonomous subagent (`transcriber`) for single-pass media processing, keyword matching, timeline summarization, and direct Q&A.
- **Slash Command**: Use `/transcribe <file>` in your OpenCode prompt to transcribe and analyze any media file in one shot.
- **Safe File Saving**: Save transcription transcripts to `.txt` files in your workspace with path traversal and overwrite protection via `save_transcription`.
- **Offline & Local Execution**: Runs locally without sending audio to third-party cloud APIs. Default model (`ggml-base.en.bin`) is automatically cached locally on first use.

---

## Directory Structure

```
whisper2opencode/
├── scripts/                    # Build and distribution packaging scripts
│   └── copy-markdowns.js
├── src/
│   ├── __tests__/              # TypeScript unit and integration tests (bun:test)
│   │   ├── configuration/      # Skill, agent, and command configuration tests
│   │   ├── utils/              # Audio decoding, transcription, file tests
│   │   ├── index.test.ts       # Plugin entry point tests
│   │   └── tsconfig.json       # Test project compiler options
│   ├── agents/                 # Subagent definitions (.md)
│   │   └── transcriber.md      # Specialized media transcription subagent
│   ├── commands/               # Slash command definitions (.md)
│   │   └── transcribe.md       # /transcribe command definition
│   ├── configuration/          # OpenCode configuration handlers
│   ├── skills/                 # Orchestrator skill definitions (SKILL.md)
│   │   └── audio-video-transcription/
│   │       └── SKILL.md        # Transcription orchestration skill for main agents
│   ├── tools/                  # OpenCode tool definitions
│   │   ├── convert_audio.ts    # Audio conversion and normalization
│   │   ├── save_transcription.ts # Safe transcription file writer
│   │   └── transcribe.ts       # whisper.cpp transcription tool
│   ├── types/                  # TypeScript interface definitions
│   ├── utils/                  # Audio decoding, whisper wrapper, file utils
│   └── index.ts                # Main plugin factory entry point
├── bunfig.toml                 # Test coverage thresholds (80% minimum)
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- [OpenCode](https://opencode.ai/) CLI installed and configured
- [Bun](https://bun.sh/) >= 1.3 (runtime for tests, build scripts, and dependencies)

---

## Installation

Add `whisper2opencode` to the `plugin` array in your `opencode.json` ([global or project-level](https://opencode.ai/docs/plugins/#load-order)):

### Global Installation (Recommended)

**Linux / macOS:**
```sh
~/.config/opencode/opencode.json
```

**Windows:**
```powershell
%USERPROFILE%\.config\opencode\opencode.json
```

In `opencode.json`:
```json
{
  "plugin": [
    "whisper2opencode@latest"
  ]
}
```

### Local Development Installation

Clone and link the repository locally:
```bash
git clone https://github.com/palucdev/whisper2opencode.git
cd whisper2opencode
bun install
bun run local-install
```

---

## Usage

### 1. Slash Command

Type `/transcribe` followed by the file path in OpenCode chat:

```bash
/transcribe recordings/team-standup.mp4
```

Or transcribe and request a specific analysis in the prompt:

```bash
/transcribe meeting.m4a Summarize the key decisions and list whenever "deployment" was mentioned with timestamps
```

### 2. Conversational Delegation

Discuss media files naturally with OpenCode. The main agent automatically delegates to the `transcriber` subagent:

```
User: "Can you transcribe recordings/interview.wav and save the result as transcripts/interview.txt?"
```

The agent runs transcription in a single pass, parses the word-level timestamps, formats the summary, and writes the output file.

---

## Available Tools

| Tool | Purpose | Key Parameters |
|---|---|---|
| `transcribe` | Transcribe audio or video into timestamped words and metadata. | `filePath` (required), `language` (optional, default `'en'`), `modelPath` (optional) |
| `convert_audio` | Extract or re-encode audio tracks into 16kHz mono `.wav` or `.pcmf32`. | `inputPath` (required), `outputPath`, `format`, `sampleRate`, `channels`, `overwrite` |
| `save_transcription` | Safely write transcription text (with a leading `---` metadata header for `source_file` and `duration`) to a `.txt` file within the working directory. | `filePath` (required, relative `.txt`), `content` (required), `sourceFile` (optional), `duration` (optional) |

---

## Supported Media Formats

### Audio
- Waveform Audio (`.wav`)
- MPEG Audio Layer III (`.mp3`)
- MPEG-4 Audio (`.m4a`, `.aac`)
- Ogg Vorbis / Opus (`.ogg`, `.opus`)
- Free Lossless Audio Codec (`.flac`)
- Raw 16kHz mono float32 PCM (`.pcmf32`)

### Video (Audio stream extracted automatically)
- MP4 (`.mp4`, `.m4v`)
- Matroska (`.mkv`)
- QuickTime (`.mov`)
- WebM (`.webm`)
- AVI (`.avi`)
- MPEG Transport Stream (`.ts`, `.mts`, `.m2ts`)

---

## Whisper Models

By default, the plugin automatically downloads and caches `ggml-base.en.bin` (~142 MB) from Hugging Face into `~/.cache/whisper2opencode/` on first use.

To use custom or multilingual models (e.g. `ggml-large-v3.bin`, `ggml-medium.bin`):
1. **Per-call**: Provide `modelPath` in the `/transcribe` command or tool argument.
2. **Environment Variable**: Set `WHISPER_MODEL_PATH`:
   ```bash
   export WHISPER_MODEL_PATH="/path/to/ggml-base.bin"
   ```

---

## Development & Testing

```bash
# Install dependencies
bun install

# Run type checking
bun run type-check

# Run test suite with coverage
bun run test

# Format code with Prettier
bun run prettify

# Build production bundle
bun run build
```

---

## License

[MIT](LICENSE) © 2026 Dawid Paluchowski
