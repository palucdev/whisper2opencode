---
name: transcribe
description: Transcribe an audio or video file using whisper.cpp and return metadata, timestamped words, and spoken analysis
agent: transcriber
subtask: true
---
Transcribe the specified audio or video file: "$ARGUMENTS"

1. Run the `transcribe` tool for the given file path.
2. Provide file metadata (filename, duration, format).
3. If requested by the user, save the sequence of timestamped words (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] word` per row) to a .txt file using `save_transcription` with `sourceFile` and `duration` so the metadata header (`--- source_file / duration ---`) is written at the beginning of the file.
4. Return the coherent sentences/passages, a clear spoken summary, timestamped highlights, and a hint to check the saved transcription file for word-level timestamp details.
