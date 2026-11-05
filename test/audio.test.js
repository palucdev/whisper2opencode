import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import WhisperPlugin from "../dist/index.js";
import {
  SAMPLE_RATE,
  convertAudioFile,
  decodeAudioToFloat32,
  getFileType,
  isVideoFile,
  resolveMediaFile,
} from "../dist/utils/audio.js";

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

test("isVideoFile and getFileType classify audio and video paths", () => {
  assert.equal(SAMPLE_RATE, 16000);
  assert.equal(isVideoFile("clip.mp4"), true);
  assert.equal(isVideoFile("MOVIE.MKV"), true);
  assert.equal(isVideoFile("voice.wav"), false);
  assert.equal(isVideoFile("song.mp3"), false);

  assert.equal(getFileType("/tmp/jfk.wav"), "audio/wav");
  assert.equal(getFileType("/tmp/clip.MP4"), "video/mp4");
  assert.equal(getFileType("/tmp/noext"), "audio");
});

test("resolveMediaFile validates media paths and provides recovery hints", () => {
  const { resolvedPath, stat } = resolveMediaFile(
    "jfk.wav",
    "/tmp/opencode",
    "filePath",
  );
  assert.equal(resolvedPath, "/tmp/opencode/jfk.wav");
  assert.ok(stat.size > 0);

  assert.throws(
    () => resolveMediaFile("   ", "/tmp/opencode", "filePath"),
    /Missing required 'filePath' argument[\s\S]*Hint:/,
  );

  assert.throws(
    () => resolveMediaFile("/tmp/opencode/missing.wav", "/tmp/opencode", "inputPath"),
    /Source media file not found:[\s\S]*Hint:/,
  );

  assert.throws(
    () => resolveMediaFile("/tmp/opencode", "/tmp/opencode", "filePath"),
    /Path is a directory[\s\S]*Hint:/,
  );

  const emptyFile = path.join(
    os.tmpdir(),
    `whisper2opencode-empty-${process.pid}.wav`,
  );
  fs.writeFileSync(emptyFile, "");
  try {
    assert.throws(
      () => resolveMediaFile(emptyFile, "/tmp/opencode", "filePath"),
      /Audio\/video file is empty \(0 bytes\)[\s\S]*Hint:/,
    );
  } finally {
    if (fs.existsSync(emptyFile)) fs.unlinkSync(emptyFile);
  }
});

test("decodeAudioToFloat32 decodes valid media and rejects corrupted or silent inputs with hints", () => {
  const samples = decodeAudioToFloat32("/tmp/opencode/jfk.wav");
  assert.ok(samples instanceof Float32Array);
  assert.equal(Math.round(samples.length / SAMPLE_RATE), 11);

  // Corrupted / non-media file
  const invalidAudioPath = path.join(
    os.tmpdir(),
    `whisper2opencode-invalid-${process.pid}.mp3`,
  );
  fs.writeFileSync(invalidAudioPath, "<html><body>404 Not Found</body></html>");
  try {
    assert.throws(
      () => decodeAudioToFloat32(invalidAudioPath),
      /Failed to decode audio[\s\S]*Hint:/,
    );
  } finally {
    if (fs.existsSync(invalidAudioPath)) fs.unlinkSync(invalidAudioPath);
  }

  // Empty .pcmf32 file (< 4 bytes)
  const tinyPcmPath = path.join(
    os.tmpdir(),
    `whisper2opencode-tiny-${process.pid}.pcmf32`,
  );
  fs.writeFileSync(tinyPcmPath, Buffer.from([1, 2]));
  try {
    assert.throws(
      () => decodeAudioToFloat32(tinyPcmPath),
      /contains 0 samples[\s\S]*Hint:/,
    );
  } finally {
    if (fs.existsSync(tinyPcmPath)) fs.unlinkSync(tinyPcmPath);
  }

  // Silent video without an audio stream
  const silentVideoPath = path.join(
    os.tmpdir(),
    `whisper2opencode-silent-${process.pid}.mp4`,
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
        "color=c=black:s=160x120:r=5:d=1",
        "-an",
        "-c:v",
        "mpeg4",
        silentVideoPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    assert.throws(
      () => decodeAudioToFloat32(silentVideoPath),
      /Failed to isolate audio from video[\s\S]*no audio stream found[\s\S]*Hint:/,
    );
  } finally {
    if (fs.existsSync(silentVideoPath)) fs.unlinkSync(silentVideoPath);
  }
});

test("convert_audio tool and convertAudioFile convert formats and enforce path/overwrite guards", async () => {
  const hooks = await WhisperPlugin({});
  assert.ok(
    hooks.tool?.convert_audio,
    "Plugin should register 'convert_audio' tool",
  );
  const ctx = createTestContext();

  const outputPcmPath = path.join(
    os.tmpdir(),
    `whisper2opencode-converted-${process.pid}.pcmf32`,
  );
  try {
    const resultPath = await hooks.tool.convert_audio.execute(
      {
        inputPath: "/tmp/opencode/jfk.wav",
        outputPath: outputPcmPath,
        format: "pcmf32",
        sampleRate: 16000,
        channels: 1,
        overwrite: true,
      },
      ctx,
    );

    assert.equal(resultPath, outputPcmPath);
    assert.ok(fs.existsSync(outputPcmPath));
    const decoded = decodeAudioToFloat32(outputPcmPath);
    assert.equal(Math.round(decoded.length / SAMPLE_RATE), 11);

    // Rejects when overwrite is false and output already exists
    assert.throws(
      () =>
        convertAudioFile({
          inputPath: "/tmp/opencode/jfk.wav",
          outputPath: outputPcmPath,
          format: "pcmf32",
          overwrite: false,
        }),
      /Output file already exists:[\s\S]*Hint:/,
    );

    // Rejects when outputPath equals inputPath
    assert.throws(
      () =>
        convertAudioFile({
          inputPath: "/tmp/opencode/jfk.wav",
          outputPath: "/tmp/opencode/jfk.wav",
          format: "wav",
        }),
      /cannot be the same as input path[\s\S]*Hint:/,
    );

    // Rejects missing source file
    await assert.rejects(
      () =>
        hooks.tool.convert_audio.execute(
          {
            inputPath: "/tmp/opencode/nonexistent-source.mp4",
            format: "wav",
          },
          ctx,
        ),
      /Source media file not found:[\s\S]*Hint:/,
    );
  } finally {
    if (fs.existsSync(outputPcmPath)) {
      fs.unlinkSync(outputPcmPath);
    }
  }
});
