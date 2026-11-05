# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-05

### Added

- **OpenCode Plugin Architecture**: Registered via `@opencode-ai/plugin` with support for tools, commands, agents, and lifecycle disposal.
- **Transcription Tools**:
  - `transcribe`: Transcribes audio and video files (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac`, `.webm`, `.mp4`, `.mkv`, `.mov`, `.avi`, `.pcmf32`) into timestamped words and file metadata with automatic audio track isolation.
  - `convert_audio`: Normalizes and converts audio/video files to 16kHz mono `.wav` or `.pcmf32` using `ffmpeg-static`.
  - `save_transcription`: Safely saves transcription `.txt` files into the active working directory with path-traversal protection.
- **Transcriber Agent**: Specialized `transcriber` subagent for single-pass audio transcription, keyword counting, timeline extraction, and structured reporting.
- **Slash Commands**: Added `/transcribe` command for instant media transcription directly from the chat prompt.
- **Quality & Standards**: Comprehensive TypeScript test suite under `src/__tests__/` running on `bun:test` with strict coverage threshold and Prettier code formatting.
