import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import WhisperPlugin from "../dist/index.js"

const require = createRequire(import.meta.url)
const ffmpegPath = require("ffmpeg-static")

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
  }
}

test("whisper2opencode v1 plugin registers transcribe tool and decodes audio", async () => {
  const hooks = await WhisperPlugin({})
  assert.ok(hooks.tool, "Plugin should return tool map")
  assert.ok(hooks.tool.transcribe, "Plugin should register 'transcribe' tool")

  const output = await hooks.tool.transcribe.execute(
    {
      filePath: "/tmp/opencode/jfk.wav",
      language: "en",
      modelPath: "/tmp/opencode/ggml-tiny.en.bin",
    },
    createTestContext(),
  )

  assert.equal(typeof output, "string")
  assert.match(output.toLowerCase(), /fellow americans/)
  assert.match(output.toLowerCase(), /what you can do for your country/)
})

test("whisper2opencode isolates audio from video files and transcribes", async () => {
  const hooks = await WhisperPlugin({})
  const videoPath = path.join(os.tmpdir(), `whisper2opencode-test-video-${process.pid}.mp4`)

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
    )

    const output = await hooks.tool.transcribe.execute(
      {
        filePath: videoPath,
        language: "en",
        modelPath: "/tmp/opencode/ggml-tiny.en.bin",
      },
      createTestContext(),
    )

    assert.equal(typeof output, "string")
    assert.match(output.toLowerCase(), /fellow americans/)
    assert.match(output.toLowerCase(), /what you can do for your country/)
  } finally {
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath)
    }
  }
})

test("whisper2opencode provides actionable recovery hints on errors", async () => {
  const hooks = await WhisperPlugin({})
  const ctx = createTestContext()

  // 1. Missing audio/video file
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
  )

  // 2. Directory passed instead of file
  await assert.rejects(
    () =>
      hooks.tool.transcribe.execute(
        {
          filePath: "/tmp/opencode",
          modelPath: "/tmp/opencode/ggml-tiny.en.bin",
        },
        ctx,
      ),
    /Path is a directory[\s\S]*Hint:/,
  )

  // 3. Corrupted / non-media file
  const invalidAudioPath = path.join(os.tmpdir(), `whisper2opencode-invalid-${process.pid}.mp3`)
  fs.writeFileSync(invalidAudioPath, "<html><body>404 Not Found</body></html>")
  try {
    await assert.rejects(
      () =>
        hooks.tool.transcribe.execute(
          {
            filePath: invalidAudioPath,
            modelPath: "/tmp/opencode/ggml-tiny.en.bin",
          },
          ctx,
        ),
      /Failed to decode audio[\s\S]*Hint:/,
    )
  } finally {
    if (fs.existsSync(invalidAudioPath)) {
      fs.unlinkSync(invalidAudioPath)
    }
  }

  // 4. Silent video without an audio stream
  const silentVideoPath = path.join(os.tmpdir(), `whisper2opencode-silent-${process.pid}.mp4`)
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
    )

    await assert.rejects(
      () =>
        hooks.tool.transcribe.execute(
          {
            filePath: silentVideoPath,
            modelPath: "/tmp/opencode/ggml-tiny.en.bin",
          },
          ctx,
        ),
      /Failed to isolate audio from video[\s\S]*no audio stream found[\s\S]*Hint:/,
    )
  } finally {
    if (fs.existsSync(silentVideoPath)) {
      fs.unlinkSync(silentVideoPath)
    }
  }

  // 5. Missing custom model file
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
  )
})

test("whisper2opencode registers convert_audio tool and converts audio formats", async () => {
  const hooks = await WhisperPlugin({})
  assert.ok(hooks.tool.convert_audio, "Plugin should register 'convert_audio' tool")
  const ctx = createTestContext()

  const outputPcmPath = path.join(os.tmpdir(), `whisper2opencode-converted-${process.pid}.pcmf32`)
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
    )

    assert.equal(resultPath, outputPcmPath)
    assert.ok(fs.existsSync(outputPcmPath))
    assert.ok(fs.statSync(outputPcmPath).size > 0)

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
    )
  } finally {
    if (fs.existsSync(outputPcmPath)) {
      fs.unlinkSync(outputPcmPath)
    }
  }
})
