import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";
import { configureAgents } from "../dist/configuration/agents-config.js";
import WhisperPlugin from "../dist/index.js";
import { loadMarkdownDir } from "../dist/utils/file-util.js";
import {
  PLUGIN_ROOT,
  PLUGIN_VERSION,
  readPluginVersion,
} from "../dist/utils/plugin-info.js";

test("plugin-info resolves PLUGIN_ROOT and reads package version with fallback", () => {
  assert.ok(fs.existsSync(PLUGIN_ROOT));
  assert.equal(PLUGIN_VERSION, "0.1.0");
  assert.equal(readPluginVersion(PLUGIN_ROOT), "0.1.0");
  assert.equal(readPluginVersion("/nonexistent/plugin/root"), "unknown");
});

test("loadMarkdownDir loads agent markdown files and handles missing directories", () => {
  const shippedAgentPath = path.resolve(
    "/home/projekty/whisper2opencode/dist/agents/transcriber.md",
  );
  assert.ok(
    fs.existsSync(shippedAgentPath),
    "Expected dist/agents/transcriber.md to be shipped in dist/",
  );

  const agents = loadMarkdownDir("agents");
  assert.equal(agents.length, 1);
  assert.equal(agents[0].data.name, "transcriber");
  assert.equal(agents[0].data.mode, "subagent");

  assert.deepEqual(loadMarkdownDir("nonexistent-dir"), []);
});

test("configureAgents and plugin config hook register transcriber agent without overwriting user config", async () => {
  const hooks = await WhisperPlugin({});
  assert.equal(
    typeof hooks.config,
    "function",
    "Expected plugin to expose config hook",
  );

  const config = {};
  await hooks.config(config);

  assert.ok(config.agent, "Expected config.agent to be initialized");
  const transcriber = config.agent.transcriber;
  assert.ok(
    transcriber,
    "Expected 'transcriber' agent to be registered in config.agent",
  );
  assert.equal(transcriber.mode, "subagent");
  assert.equal(typeof transcriber.description, "string");
  assert.ok(transcriber.description.length > 0);
  assert.equal(transcriber.tools?.transcribe, true);
  assert.equal(transcriber.tools?.convert_audio, true);
  assert.equal(transcriber.tools?.save_transcription, true);
  assert.equal(transcriber.permission?.transcribe, "allow");
  assert.equal(transcriber.permission?.convert_audio, "allow");
  assert.equal(transcriber.permission?.save_transcription, "allow");
  assert.equal(transcriber.permission?.edit, "deny");
  assert.equal(transcriber.permission?.bash, "deny");
  assert.match(transcriber.prompt, /transcribe/i);
  assert.match(transcriber.prompt, /save_transcription/i);
  assert.match(transcriber.prompt, /single/i);
  assert.match(transcriber.prompt, /analyze/i);
  assert.match(transcriber.prompt, /main agent/i);

  // User-defined agent config is not overwritten
  const customAgent = { description: "custom", prompt: "custom prompt" };
  const customConfig = { agent: { transcriber: customAgent } };
  configureAgents(customConfig);
  assert.equal(customConfig.agent.transcriber, customAgent);

  // Safely handles null/non-object config
  assert.doesNotThrow(() => configureAgents(null));
});
