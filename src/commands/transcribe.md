---
name: transcribe
description: Transcribe an audio or video file using whisper.cpp and return metadata, timestamped words, and spoken analysis
agent: transcriber
subtask: true
---
Transcribe the specified audio or video file: "$ARGUMENTS"

1. Run the `transcribe` tool for the given file path.
2. Provide file metadata (filename, duration, format).
3. If requested by the user, save the transcript to a .txt file using `save_transcription` with `sourceFile` and `duration` so the metadata header (`--- source_file / duration ---`) is written at the beginning of the file.
4. Provide a clear spoken summary and timestamped highlights.
