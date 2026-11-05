import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import WhisperPlugin from "../dist/index.js";
import { saveTranscriptionFile } from "../dist/utils/transcribe.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

function createTestContext() {
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "build",
    directory: "/home/projekty/whisper2opencode",
    worktree: "/home/projekty/whisper2opencode",
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  };
}

const WORD_LINE_REGEX =
  /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\] (.+)$/;
const DURATION_REGEX = /^(\d{2}:\d{2}:\d{2}\.\d{3}) \((\d+(?:\.\d+)?)s\)$/;

function parseTranscriptionOutput(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(
    lines.length > 3,
    "Expected metadata header and non-empty timestamped word list",
  );

  assert.match(lines[0], /^Filename:\s+.+$/);
  assert.match(lines[1], /^File type:\s+.+$/);
  assert.match(
    lines[2],
    /^Duration:\s+\d{2}:\d{2}:\d{2}\.\d{3} \(\d+(?:\.\d+)?s\)$/,
  );

  const filename = lines[0].replace(/^Filename:\s+/, "");
  const fileType = lines[1].replace(/^File type:\s+/, "");
  const durationRaw = lines[2].replace(/^Duration:\s+/, "");
  const durationMatch = DURATION_REGEX.exec(durationRaw);
  assert.ok(
    durationMatch,
    `Expected valid duration format, got: ${durationRaw}`,
  );

  const words = lines.slice(3).map((line) => {
    const match = WORD_LINE_REGEX.exec(line);
    assert.ok(
      match,
      `Expected line to match '[HH:MM:SS.mmm --> HH:MM:SS.mmm] word', got: ${line}`,
    );
    return {
      start: match[1],
      end: match[2],
      word: match[3],
    };
  });

  return {
    metadata: {
      filename,
      fileType,
      durationTimestamp: durationMatch[1],
      durationSeconds: Number(durationMatch[2]),
    },
    words,
  };
}

test(
  "transcribe tool returns file metadata and a timestamped list of spoken words",
  async () => {
    const hooks = await WhisperPlugin({});
    assert.ok(
      hooks.tool?.transcribe,
      "Plugin should register 'transcribe' tool",
    );

    const output = await hooks.tool.transcribe.execute(
      {
        filePath: "/tmp/opencode/jfk.wav",
        language: "en",
        modelPath: "/tmp/opencode/ggml-tiny.en.bin",
      },
      createTestContext(),
    );

    assert.equal(typeof output, "string");
    const { metadata, words: entries } = parseTranscriptionOutput(output);
    assert.equal(metadata.filename, "jfk.wav");
    assert.equal(metadata.fileType, "audio/wav");
    assert.equal(metadata.durationTimestamp, "00:00:11.000");
    assert.equal(metadata.durationSeconds, 11);

    const reconstructedText = entries
      .map((e) => e.word.toLowerCase())
      .join(" ");
    assert.match(reconstructedText, /fellow americans/);
    assert.match(reconstructedText, /what you can do for your country/);

    const countryMatches = entries.filter(
      (e) => e.word.toLowerCase() === "country",
    );
    assert.equal(countryMatches.length, 2);
    assert.ok(countryMatches[1].start > countryMatches[0].start);
  },
  30_000,
);

test(
  "transcribe tool isolates audio from video files and transcribes into metadata and timestamped words",
  async () => {
    const hooks = await WhisperPlugin({});
    const videoPath = path.join(
      os.tmpdir(),
      `whisper2opencode-test-video-${process.pid}.mp4`,
    );

    try {
      execFileSync(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=160x120:r=5",
          "-i",
          "/tmp/opencode/jfk.wav",
          "-shortest",
          "-c:v",
          "mpeg4",
          "-c:a",
          "aac",
          videoPath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      const output = await hooks.tool.transcribe.execute(
        {
          filePath: videoPath,
          language: "en",
          modelPath: "/tmp/opencode/ggml-tiny.en.bin",
        },
        createTestContext(),
      );

      assert.equal(typeof output, "string");
      const { metadata, words: entries } = parseTranscriptionOutput(output);
      assert.equal(metadata.filename, path.basename(videoPath));
      assert.equal(metadata.fileType, "video/mp4");
      assert.ok(
        metadata.durationSeconds >= 10.9 && metadata.durationSeconds <= 11.2,
      );

      const reconstructedText = entries
        .map((e) => e.word.toLowerCase())
        .join(" ");
      assert.match(reconstructedText, /fellow americans/);
      assert.match(reconstructedText, /what you can do for your country/);
    } finally {
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    }
  },
  30_000,
);

test(
  "transcribe tool caches transcription results for unchanged files",
  async () => {
    const hooks = await WhisperPlugin({});
    const ctx = createTestContext();

    const first = await hooks.tool.transcribe.execute(
      {
        filePath: "/tmp/opencode/jfk.wav",
        language: "en",
        modelPath: "/tmp/opencode/ggml-tiny.en.bin",
      },
      ctx,
    );

    const start = performance.now();
    const second = await hooks.tool.transcribe.execute(
      {
        filePath: "/tmp/opencode/jfk.wav",
        language: "en",
        modelPath: "/tmp/opencode/ggml-tiny.en.bin",
      },
      ctx,
    );
    const elapsedMs = performance.now() - start;

    assert.equal(second, first);
    assert.ok(
      elapsedMs < 100,
      `Expected cached transcription under 100ms, got ${elapsedMs}ms`,
    );
  },
  30_000,
);

test("transcribe tool provides actionable recovery hints on media and model errors", async () => {
  const hooks = await WhisperPlugin({});
  const ctx = createTestContext();

  // Missing audio/video file
  await assert.rejects(
    () =>
      hooks.tool.transcribe.execute(
        {
          filePath: "/tmp/opencode/does-not-exist.mp3",
          modelPath: "/tmp/opencode/ggml-tiny.en.bin",
        },
        ctx,
      ),
    /Audio\/video file not found:[\s\S]*Hint:/,
  );

  // Missing custom model file
  await assert.rejects(
    () =>
      hooks.tool.transcribe.execute(
        {
          filePath: "/tmp/opencode/jfk.wav",
          modelPath: "/tmp/opencode/missing-model.bin",
        },
        ctx,
      ),
    /Whisper model file not found at:[\s\S]*Hint:/,
  );

  // Directory passed as modelPath
  await assert.rejects(
    () =>
      hooks.tool.transcribe.execute(
        {
          filePath: "/tmp/opencode/jfk.wav",
          modelPath: "/tmp/opencode",
        },
        ctx,
      ),
    /Whisper model path is invalid \(is a directory\):[\s\S]*Hint:/,
  );
});

test("save_transcription tool saves new .txt transcription files in the working directory and blocks unsafe operations", async () => {
  const hooks = await WhisperPlugin({});
  assert.ok(
    hooks.tool?.save_transcription,
    "Plugin should register 'save_transcription' tool",
  );

  const tempWorkDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `whisper2opencode-save-${process.pid}-`),
  );
  const ctx = {
    ...createTestContext(),
    directory: tempWorkDir,
    worktree: tempWorkDir,
  };

  try {
    // Saves a .txt transcription file inside the working directory
    const savedPath = await hooks.tool.save_transcription.execute(
      {
        filePath: "transcripts/jfk.transcription.txt",
        content: "And so my fellow Americans, ask not what your country can do for you.",
      },
      ctx,
    );

    assert.equal(
      savedPath,
      path.join(tempWorkDir, "transcripts", "jfk.transcription.txt"),
    );
    assert.equal(
      fs.readFileSync(savedPath, "utf8"),
      "And so my fellow Americans, ask not what your country can do for you.",
    );

    // Automatically appends .txt when no extension is provided
    const autoExtPath = await hooks.tool.save_transcription.execute(
      {
        filePath: "jfk-notes",
        content: "Timestamped transcript content",
      },
      ctx,
    );
    assert.equal(autoExtPath, path.join(tempWorkDir, "jfk-notes.txt"));
    assert.ok(fs.existsSync(autoExtPath));

    // Rejects overwriting an existing file
    await assert.rejects(
      () =>
        hooks.tool.save_transcription.execute(
          {
            filePath: "jfk-notes.txt",
            content: "Modified content",
          },
          ctx,
        ),
      /Transcription file already exists:[\s\S]*Hint:/,
    );

    // Rejects non-.txt file extensions
    assert.throws(
      () =>
        saveTranscriptionFile({
          filePath: "malicious.js",
          content: "console.log('nope');",
          directory: tempWorkDir,
        }),
      /Invalid transcription file extension "\.js"[\s\S]*Only "\.txt" transcription files are allowed[\s\S]*Hint:/,
    );

    // Rejects path traversal outside the working directory
    assert.throws(
      () =>
        saveTranscriptionFile({
          filePath: "../outside.txt",
          content: "escaped",
          directory: tempWorkDir,
        }),
      /outside the working directory[\s\S]*Hint:/,
    );

    // Rejects absolute paths outside the working directory
    assert.throws(
      () =>
        saveTranscriptionFile({
          filePath: "/tmp/outside-work-dir.txt",
          content: "escaped",
          directory: tempWorkDir,
        }),
      /outside the working directory[\s\S]*Hint:/,
    );

    // Rejects hidden files / directories
    assert.throws(
      () =>
        saveTranscriptionFile({
          filePath: ".env",
          content: "SECRET=1",
          directory: tempWorkDir,
        }),
      /cannot target hidden files or directories[\s\S]*Hint:/,
    );

    // Rejects missing filePath or empty content
    assert.throws(
      () =>
        saveTranscriptionFile({
          filePath: "   ",
          content: "valid content",
          directory: tempWorkDir,
        }),
      /Missing required 'filePath' argument[\s\S]*Hint:/,
    );

    assert.throws(
      () =>
        saveTranscriptionFile({
          filePath: "valid.txt",
          content: "   ",
          directory: tempWorkDir,
        }),
      /Missing or empty 'content' argument[\s\S]*Hint:/,
    );
  } finally {
    fs.rmSync(tempWorkDir, { recursive: true, force: true });
  }
});

