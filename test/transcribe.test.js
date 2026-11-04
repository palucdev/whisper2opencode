import assert from "node:assert/strict"
import test from "node:test"
import WhisperPlugin from "../dist/index.js"

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
    {
      sessionID: "test-session",
      messageID: "test-msg",
      agent: "build",
      directory: "/home/projekty/whisper2opencode",
      worktree: "/home/projekty/whisper2opencode",
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    },
  )

  assert.equal(typeof output, "string")
  assert.match(output.toLowerCase(), /fellow americans/)
  assert.match(output.toLowerCase(), /what you can do for your country/)
})
