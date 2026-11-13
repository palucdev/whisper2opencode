---
name: audio-video-transcription
description: >-
  Audio and video transcription, recording analysis, speech-to-text (STT),
  voice-to-text, and spoken-content extraction via specialized transcriber
  subagents. Proactively load and use this skill whenever the user or workflow
  mentions or involves any recording, recordings, audio, video, media, clip,
  footage, sound, soundtrack, voice, voice note, voice memo, dictation, speech,
  spoken dialogue, conversation, meeting, standup, call, interview, lecture,
  presentation, webinar, podcast, screencast, or screen recording, or references
  media files (.wav, .mp3, .m4a, .aac, .ogg, .opus, .flac, .pcmf32, .mp4, .m4v,
  .mkv, .mov, .webm, .avi, .ts, .mts, .m2ts). Use when asked to transcribe,
  caption, subtitle, listen to, or analyze a recording, audio, or video; figure
  out what was said, spoken, or discussed; extract quotes or dialogue; locate
  word or phrase timestamps/timecodes; count spoken words or keywords; summarize
  recordings; or save transcripts. Because the transcribe tool is restricted to
  the transcriber subagent, main agents and workflow orchestrators must use this
  skill to delegate single-file or parallel multi-file transcription tasks to
  transcriber subagents.
---

# Audio & Video Transcription Orchestration Skill

This skill enables any main agent or workflow orchestrator to perform local audio and video transcription, timestamp extraction, and spoken-content analysis by delegating media tasks to `transcriber` subagents.

## Core Orchestration Principles

1. **Always Delegate to `transcriber` Subagents**:
   - Use the `Task` tool with `subagent_type: "transcriber"` whenever an audio or video recording needs to be transcribed or analyzed.
   - The `transcribe` tool is restricted exclusively to the `transcriber` subagent (raw word-level timestamp output can be thousands of lines per recording and would bloat the main agent's context window). Never use `read` or `bash` to inspect raw binary audio/video files.
2. **One File Per `transcriber` Subagent**:
   - Each `transcriber` subagent is specialized to process **one** media file in a single pass.
3. **Parallel Fan-Out for Multiple Media Files**:
   - When a task involves multiple audio or video files, launch multiple `transcriber` subagent `Task` calls **in parallel within a single message** (one subagent per file).
   - Once all subagents return their structured reports, synthesize or compare the findings in the main orchestrator.
4. **Single-Pass Requirements Gathering**:
   - Include all analytical questions, target keywords/phrases to count, timestamp lookup requests, and `.txt` saving instructions in the initial prompt to the `transcriber` subagent so it can fulfill everything from a single transcription pass.

---

## Supported Media & Capabilities

- **Audio Formats**: `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.flac`, `.pcmf32`
- **Video Formats (Automatic Audio Track Isolation via `ffmpeg-static`)**: `.mp4`, `.m4v`, `.mkv`, `.mov`, `.webm`, `.avi`, `.ts`, `.mts`, `.m2ts`
- **Word-Level Timestamps & Metadata**: Extracts filename, media type, total soundtrack duration (`HH:MM:SS.mmm (Xs)`), and word-by-word timestamps (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] word`).
- **Automatic Container Recovery**: The `transcriber` subagent automatically uses `convert_audio` to normalize incompatible or damaged containers to 16kHz mono if direct transcription fails.
- **Safe Transcript Persistence & Metadata Header**: When instructed, the `transcriber` subagent uses `save_transcription` to save the sequence of timestamped words (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] word`, one per row) to a new `.txt` file inside the current working directory (never overwrites existing files or writes outside the workspace). Every saved `.txt` file begins with a `---`-delimited YAML frontmatter metadata block (`source_file` and `duration`) separated from the timestamped word rows by a blank line so transcript consumers can easily parse or strip it automatically:
  ```text
  ---
  source_file: <filename>
  duration: <HH:MM:SS.mmm (Xs)>
  ---

  [00:00:00.000 --> 00:00:00.320] <word1>
  [00:00:00.320 --> 00:00:00.640] <word2>
  ```
  Downstream consumers can strip this header automatically with `/^---\r?\n[\s\S]*?\r?\n---\r?\n+/`, `sed '1{/^---$/!q;};1,/^---$/d'`, or `gray-matter`.

---

## Orchestration Workflow

### Step 1: Identify Media Targets and Task Parameters

Before invoking the subagent(s), extract the following from the user's request or active workflow context:

| Parameter | Required | Description |
|---|---|---|
| `filePath` | Yes | Path to the audio or video file (relative to working directory or absolute). |
| `language` | No | Spoken language code (defaults to `'en'`). Pass explicitly if non-English audio is expected. |
| `modelPath` | No | Optional path to a custom local `whisper.cpp` GGML `.bin` model file. |
| `saveOutputPath` | No | Relative `.txt` file path inside the working directory if the user or workflow wants the transcript saved to disk (e.g., `transcripts/interview.txt`). |
| `analysisGoals` | No | Specific questions to answer, topics to summarize, keywords/phrases to count, or sections requiring exact `[start --> end]` timestamps. |

### Step 2: Delegate to `transcriber` Subagent(s)

Invoke the `Task` tool with `subagent_type: "transcriber"`.

- **Single file**: Send 1 `Task` tool call.
- **Multiple files**: Send N `Task` tool calls in **one message** (1 per file) for concurrent execution.

#### Subagent Prompt Template

```markdown
Transcribe and analyze the following media file:
- File Path: <filePath>
- Language: <language or "en (default)">
- Custom Model Path: <modelPath or "default">
- Save Transcription File: <"Yes, save the sequence of timestamped words ([HH:MM:SS.mmm --> HH:MM:SS.mmm] word per row) to <relative-path>.txt" or "No">

## Requested Analysis
1. Provide full file metadata (filename, file type, duration), the reconstructed coherent sentences/passages, and a hint pointing to the saved transcription file for word-level timestamp details.
2. <Specific analytical instructions: e.g., summarize key decisions, extract action items, answer specific questions>
3. <Keyword/timestamp instructions: e.g., count occurrences of "<word/phrase>" and list exact [HH:MM:SS.mmm --> HH:MM:SS.mmm] timestamps for every match>
```

### Step 3: Process and Synthesize Subagent Results

Each `transcriber` subagent returns a structured markdown report containing:
- **File Metadata**: Filename, file type (`audio/*` or `video/*`), soundtrack duration, and saved `.txt` path (if requested).
- **Transcription**: Reconstructed coherent sentences/passages of the spoken audio, accompanied by a hint to check the saved transcription `.txt` file for full word-level timestamp details (`[HH:MM:SS.mmm --> HH:MM:SS.mmm] word` per row).
- **Analysis**: Summary and direct answers to the orchestrator's prompt, including word/phrase occurrence counts and exact timestamps.
- **Timestamped Highlights**: Key moments mapped to `[HH:MM:SS.mmm --> HH:MM:SS.mmm]` intervals.

**Orchestrator Actions**:
- For **direct user queries**: Present a clear, concise answer incorporating the subagent's transcription, timestamps, and saved file location.
- For **multi-file or workflow orchestration** (e.g., research gathering, bug analysis from screen recordings, meeting synthesis, specification discovery): Cross-reference findings across all subagent reports and integrate the evidence (with file names and timestamps) into your workflow artifacts.

### Step 4: Follow-Up Questions (Session Reuse)

If follow-up questions arise about a media file that was already transcribed in the current session:
1. Check if the answer is already present in the `transcriber` subagent's returned report.
2. If deeper inspection of word-level timestamps is needed, **resume the existing subagent session** by passing its `task_id` to the `Task` tool (`subagent_type: "transcriber"`, `task_id: "<previous_task_id>"`) so it can query its existing in-context transcript without running `transcribe` a second time.

---

## Error Handling

- **Missing whisper.cpp or Speech Model**: If transcription fails because `whisper.cpp` is missing or the model cannot be downloaded, use the `download_whisper_cpp` tool (or `download_whisper`) to automatically install `whisper.cpp` for the detected package manager (Bun/npm/pnpm/yarn) and cache the required GGML model.
- **Missing or Empty File**: If the subagent reports that the file does not exist or is empty, use `glob` to locate the correct media file path in the workspace or ask the user to verify the path.
- **Video Without Audio Stream**: If the subagent reports that a video container has no audio track (silent screen recording), inform the user that no spoken audio stream exists in the container.
- **Output File Already Exists**: `save_transcription` refuses to overwrite existing `.txt` files. If saving fails because the target `.txt` file already exists, instruct the subagent (or ask the user) to use a new non-conflicting `.txt` filename.
