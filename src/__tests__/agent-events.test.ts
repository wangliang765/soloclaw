import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentLoop } from "../core/agent-loop.js";
import type { AgentRunEvent } from "../core/agent-events.js";
import { withEventDefaults } from "../core/agent-events.js";
import { redactAgentEventText, summarizeToolInput } from "../core/agent-event-redaction.js";
import { projectAgentRunEventsToAssistantMessages } from "../core/agent-message-projector.js";
import type { ModelClient } from "../model/model-client.js";
import { AnthropicCompatibleMessagesClient, OpenAICompatibleChatClient } from "../model/http-model-clients.js";
import { createLocalPlatform } from "../platform/local-platform.js";
import type { RegisteredTool } from "../protocol/types.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";
import { LocalWorkspaceRuntime } from "../workspace/local-workspace-runtime.js";
import { LocalEventBus } from "../events/local-event-bus.js";
import { startLocalRoomWebServer } from "../web/local-room-web-server.js";

test("agent event redaction removes api keys from display text", () => {
  const value = redactAgentEventText("use sk-testsecretvalue1234567890 in command");
  assert.equal(value.includes("sk-testsecretvalue1234567890"), false);
  assert.match(value, /\[REDACTED:api_key\]/);
});

test("tool input summary hides command details by default", () => {
  const summary = summarizeToolInput("run_command", {
    command: "powershell -Command $env:SECRET='sk-testsecretvalue1234567890'; npm test",
    timeoutMs: 1000,
  });
  assert.equal(summary.title, "Run command");
  assert.equal(summary.detailsHidden, true);
  assert.equal(JSON.stringify(summary).includes("sk-testsecretvalue1234567890"), false);
});

test("agent run event type supports folded tool rows", () => {
  const event: AgentRunEvent = {
    type: "tool_finished",
    runId: "run_test",
    sessionId: "sess_test",
    step: 1,
    callId: "call_test",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    durationMs: 12,
    detailsHidden: true,
  };
  assert.equal(event.type, "tool_finished");
  assert.equal(event.detailsHidden, true);
});

test("runtime stopped events keep safe resumability metadata", () => {
  const event = withEventDefaults({
    type: "runtime_stopped",
    runId: "run_phase3",
    sessionId: "sess_phase3",
    stopKind: "step_budget",
    targetMode: "goal",
    maxSteps: 2,
    reason: "Step budget reached before final answer.",
    resumeCommand: "agent resume sess_phase3",
  });

  assert.equal(event.type, "runtime_stopped");
  assert.equal(event.sessionId, "sess_phase3");
  assert.equal(event.stopKind, "step_budget");
  assert.equal(event.targetMode, "goal");
  assert.equal(event.maxSteps, 2);
  assert.equal(event.resumeCommand, "agent resume sess_phase3");
  assert.equal(typeof event.createdAt, "string");
});

test("projects agent events into replayable safe assistant parts", () => {
  const unsafeCommand = "powershell -Command Write-Output sk-testsecretvalue1234567890";
  const unsafePatch = "diff --git a/src/main.js b/src/main.js\n+console.log('sk-testsecretvalue1234567890')";
  const events: AgentRunEvent[] = [
    { type: "step_started", runId: "run_project", sessionId: "sess_project", step: 1, provider: "deepseek", model: "deepseek-v4-flash" },
    { type: "assistant_text", runId: "run_project", sessionId: "sess_project", step: 1, text: "I will inspect " },
    { type: "assistant_text", runId: "run_project", sessionId: "sess_project", step: 1, text: "the workspace." },
    {
      type: "tool_started",
      runId: "run_project",
      sessionId: "sess_project",
      step: 1,
      callId: "call_run",
      toolName: "run_command",
      title: "Run command",
      detailsHidden: true,
      paths: ["src/main.js"],
      input: { command: unsafeCommand, patch: unsafePatch },
    } as AgentRunEvent,
    {
      type: "tool_finished",
      runId: "run_project",
      sessionId: "sess_project",
      step: 1,
      callId: "call_run",
      toolName: "run_command",
      title: "Run command",
      status: "ok",
      durationMs: 42,
      detailsHidden: true,
      paths: ["src/main.js"],
      exitCode: 0,
      output: `raw stdout ${unsafeCommand}`,
    } as AgentRunEvent,
    { type: "model_finished", runId: "run_project", sessionId: "sess_project", step: 1, responseType: "tool_calls", toolCallCount: 1, durationMs: 99 },
  ];

  const messages = projectAgentRunEventsToAssistantMessages(events);
  const parts = messages[0]?.parts as
    | Array<{ type: string; text?: string; status?: string; detailsHidden?: boolean; paths?: string[] }>
    | undefined;

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.runId, "run_project");
  assert.equal(messages[0]?.sessionId, "sess_project");
  assert.deepEqual(parts?.map((part) => part.type), ["status", "text", "tool", "status"]);
  assert.equal(parts?.[1]?.text, "I will inspect the workspace.");
  const toolPart = parts?.find((part) => part.type === "tool");
  assert.equal(toolPart?.status, "ok");
  assert.equal(toolPart?.detailsHidden, true);
  assert.deepEqual(toolPart?.paths, ["src/main.js"]);

  const projectedJson = JSON.stringify(messages);
  assert.equal(projectedJson.includes(unsafeCommand), false);
  assert.equal(projectedJson.includes(unsafePatch), false);
  assert.equal(projectedJson.includes("raw stdout"), false);
  assert.equal(projectedJson.includes("sk-testsecretvalue1234567890"), false);
});

test("projects expanded safe tool details without raw command or output", () => {
  const event = {
    type: "tool_finished",
    runId: "run_details",
    sessionId: "sess_details",
    step: 2,
    callId: "call_cmd",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    detailsHidden: true,
    paths: ["README.md"],
    exitCode: 0,
    timedOut: false,
    durationMs: 31,
    stdoutBytes: 120,
    stderrBytes: 0,
    command: "npm test -- --token sk-testsecretvalue1234567890",
    output: "raw stdout sk-testsecretvalue1234567890",
    patch: "diff --git a/README.md b/README.md",
  } as AgentRunEvent;

  const messages = projectAgentRunEventsToAssistantMessages([event]);
  const toolPart = messages[0]?.parts.find((part) => part.type === "tool");

  assert.equal(toolPart?.type, "tool");
  assert.deepEqual(toolPart?.type === "tool" ? toolPart.safeDetails : undefined, {
    paths: ["README.md"],
    exitCode: 0,
    timedOut: false,
    durationMs: 31,
    stdoutBytes: 120,
    stderrBytes: 0,
  });
  const projectedJson = JSON.stringify(messages);
  assert.equal(projectedJson.includes("npm test"), false);
  assert.equal(projectedJson.includes("raw stdout"), false);
  assert.equal(projectedJson.includes("diff --git"), false);
  assert.equal(projectedJson.includes("sk-testsecretvalue1234567890"), false);
});

test("agent loop emits rich safe events for tool execution", async () => {
  const events: AgentRunEvent[] = [];
  const store = new MemoryAgentStore();
  const model: ModelClient = {
    async complete(request) {
      const hasTool = request.messages.some((message) => message.role === "tool");
      return hasTool
        ? { type: "message", content: "done" }
        : {
            type: "tool_calls",
            content: "I will inspect files.",
            toolCalls: [{ id: "call_list", name: "list_files", input: { path: "." } }],
          };
    },
  };
  const tools: RegisteredTool[] = [
    {
      name: "list_files",
      description: "List files.",
      inputSchema: {},
      handler: async () => ({
        callId: "list_files",
        ok: true,
        output: "README.md",
        display: { title: "List .", paths: ["."], detailsHidden: true },
      }),
    },
  ];
  const agent = new AgentLoop({
    model,
    tools,
    systemPrompt: "system",
    store,
    actor: { type: "user", id: "tester" },
    onProgress: (event) => {
      events.push(event as AgentRunEvent);
    },
  });

  const answer = await agent.run("inspect");

  assert.equal(answer, "done");
  assert.equal(events.some((event) => event.type === "session_started"), true);
  assert.equal(events.some((event) => event.type === "step_started"), true);
  assert.equal(events.some((event) => event.type === "assistant_note"), true);
  assert.equal(events.some((event) => event.type === "tool_started" && event.title === "List ."), true);
  assert.equal(events.some((event) => event.type === "tool_finished" && event.status === "ok"), true);
  assert.equal(events.some((event) => event.type === "assistant_text" && event.final), true);
  const sessionId = events.find((event) => event.type === "session_started")?.sessionId;
  assert(sessionId);
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 50 });
  assert.equal(auditEvents.some((event) => event.summary === "agent.event.tool_finished"), true);
  assert.equal(JSON.stringify(auditEvents).includes("sk-"), false);
});

test("workspace tools return safe display metadata", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-tool-display-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "README.md"), "# Tool Display\n", "utf8");
  const tools = createWorkspaceTools(new LocalWorkspaceRuntime(dir));
  const read = tools.find((tool) => tool.name === "read_file");
  assert(read);

  const result = await read.handler({ path: "README.md" });

  assert.equal(result.ok, true);
  assert.equal(result.display?.title, "Read README.md");
  assert.deepEqual(result.display?.paths, ["README.md"]);
  assert.equal(result.display?.detailsHidden, true);
});

test("agent loop emits assistant text deltas from streaming models", async () => {
  const events: AgentRunEvent[] = [];
  const model: ModelClient = {
    async complete() {
      return { type: "message", content: "fallback" };
    },
    async *streamComplete() {
      yield { type: "text_delta", text: "hel" };
      yield { type: "text_delta", text: "lo" };
      yield { type: "message", content: "hello" };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system",
    onProgress: (event) => {
      events.push(event as AgentRunEvent);
    },
  });

  const answer = await agent.run("say hello");

  assert.equal(answer, "hello");
  assert.equal(events.some((event) => event.type === "assistant_text" && event.text === "hel" && !event.final), true);
  assert.equal(events.some((event) => event.type === "assistant_text" && event.text === "hello" && event.final), true);
});

test("agent loop emits public reasoning lifecycle events without raw reasoning text", async () => {
  const events: AgentRunEvent[] = [];
  const rawReasoning = "private chain-of-thought sk-testsecretvalue1234567890";
  const model: ModelClient = {
    async complete() {
      return { type: "message", content: "fallback" };
    },
    async *streamComplete() {
      yield { type: "reasoning_delta", text: rawReasoning };
      yield { type: "text_delta", text: "done" };
      yield { type: "message", content: "done" };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system",
    onProgress: (event) => {
      events.push(event as AgentRunEvent);
    },
  });

  const answer = await agent.run("think safely");

  assert.equal(answer, "done");
  assert.equal(events.some((event) => event.type === "reasoning_started"), true);
  assert.equal(events.some((event) => event.type === "reasoning_delta"), true);
  assert.equal(events.some((event) => event.type === "reasoning_finished"), true);
  assert.equal(events.some((event) => event.type === "assistant_note" && event.text.includes("private chain-of-thought")), false);
  assert.equal(JSON.stringify(events).includes(rawReasoning), false);
  assert.equal(JSON.stringify(projectAgentRunEventsToAssistantMessages(events)).includes(rawReasoning), false);
});

test("openai compatible client streams text deltas from SSE responses", async (t) => {
  let requestBody = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      response.write('data: {"id":"chatcmpl_test","model":"stream-test","choices":[{"delta":{"content":"hel"}}]}\n\n');
      response.write('data: {"id":"chatcmpl_test","model":"stream-test","choices":[{"delta":{"content":"lo"}}]}\n\n');
      response.write('data: {"id":"chatcmpl_test","model":"stream-test","choices":[{"delta":{}}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP test server address.");
  }
  const client = new OpenAICompatibleChatClient({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    defaultModel: "stream-test",
  });

  const events = [];
  for await (const event of client.streamComplete?.({ messages: [{ role: "user", content: "hello" }], tools: [] }) ?? []) {
    events.push(event);
  }

  assert.equal(JSON.parse(requestBody).stream, true);
  assert.deepEqual(events.slice(0, 2), [
    { type: "text_delta", text: "hel" },
    { type: "text_delta", text: "lo" },
  ]);
  const final = events.at(-1);
  assert.equal(final?.type, "message");
  assert.equal(final?.type === "message" ? final.content : "", "hello");
  assert.equal(final?.type === "message" ? final.metadata?.providerResponseId : undefined, "chatcmpl_test");
  assert.equal(final?.type === "message" ? final.metadata?.providerModel : undefined, "stream-test");
  assert.deepEqual(final?.type === "message" ? final.metadata?.usage : undefined, {
    promptTokens: 2,
    completionTokens: 2,
    totalTokens: 4,
  });
});

test("anthropic compatible client streams text deltas from SSE responses", async (t) => {
  let requestBody = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      response.write('data: {"type":"message_start","message":{"id":"msg_test","model":"claude-test","usage":{"input_tokens":2,"output_tokens":0}}}\n\n');
      response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hel"}}\n\n');
      response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n');
      response.write('data: {"type":"message_delta","usage":{"output_tokens":2}}\n\n');
      response.end('data: {"type":"message_stop"}\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP test server address.");
  }
  const client = new AnthropicCompatibleMessagesClient({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    defaultModel: "claude-test",
  });

  const events = [];
  for await (const event of client.streamComplete?.({ messages: [{ role: "user", content: "hello" }], tools: [] }) ?? []) {
    events.push(event);
  }

  assert.equal(JSON.parse(requestBody).stream, true);
  assert.deepEqual(events.slice(0, 2), [
    { type: "text_delta", text: "hel" },
    { type: "text_delta", text: "lo" },
  ]);
  const final = events.at(-1);
  assert.equal(final?.type, "message");
  assert.equal(final?.type === "message" ? final.content : "", "hello");
  assert.equal(final?.type === "message" ? final.metadata?.providerResponseId : undefined, "msg_test");
  assert.equal(final?.type === "message" ? final.metadata?.providerModel : undefined, "claude-test");
  assert.deepEqual(final?.type === "message" ? final.metadata?.usage : undefined, {
    promptTokens: 2,
    completionTokens: 2,
    totalTokens: 4,
  });
});

test("anthropic compatible client streams tool calls from SSE responses", async (t) => {
  let requestBody = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      response.write('data: {"type":"message_start","message":{"id":"msg_tool","model":"claude-tool-test","usage":{"input_tokens":5,"output_tokens":0}}}\n\n');
      response.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will inspect files."}}\n\n');
      response.write('data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n');
      response.write('data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n');
      response.write('data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"README.md\\"}"}}\n\n');
      response.write('data: {"type":"content_block_stop","index":1}\n\n');
      response.write('data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n');
      response.end('data: {"type":"message_stop"}\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP test server address.");
  }
  const client = new AnthropicCompatibleMessagesClient({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "test-key",
    defaultModel: "claude-tool-test",
  });

  const events = [];
  for await (const event of client.streamComplete?.({
    messages: [{ role: "user", content: "read the readme" }],
    tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object" } }],
  }) ?? []) {
    events.push(event);
  }

  assert.equal(JSON.parse(requestBody).stream, true);
  assert.deepEqual(events[0], { type: "text_delta", text: "I will inspect files." });
  const final = events.at(-1);
  assert.equal(final?.type, "tool_calls");
  assert.equal(final?.type === "tool_calls" ? final.content : undefined, "I will inspect files.");
  assert.deepEqual(final?.type === "tool_calls" ? final.toolCalls : undefined, [
    { id: "toolu_1", name: "read_file", input: { path: "README.md" } },
  ]);
  assert.deepEqual(final?.type === "tool_calls" ? final.metadata?.usage : undefined, {
    promptTokens: 5,
    completionTokens: 7,
    totalTokens: 12,
  });
});

test("local event bus receives safe agent progress events from platform runs", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-local-event-bus-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "README.md"), "# Event Bus\n", "utf8");
  const eventBus = new LocalEventBus();
  const events: AgentRunEvent[] = [];
  const unsubscribe = eventBus.subscribe((event) => {
    events.push(event);
  });
  t.after(() => unsubscribe());

  const platform = await createLocalPlatform(dir, { provider: "mock", eventBus });
  try {
    await platform.agent.runWithSession("inspect this workspace");
  } finally {
    platform.locks.close?.();
    platform.store.close();
  }

  assert.equal(events.some((event) => event.type === "session_started"), true);
  assert.equal(events.some((event) => event.type === "tool_finished"), true);
  assert.equal(JSON.stringify(events).includes("sk-"), false);
});

test("web API streams safe agent events through SSE", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-event-sse-"));
  const eventBus = new LocalEventBus();
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token", eventBus });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${server.baseUrl}/api/events`, {
    headers: { "x-agent-control-token": "test-token" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader);
  eventBus.publish({
    type: "tool_finished",
    runId: "run_sse",
    sessionId: "sess_sse",
    step: 1,
    callId: "call_sse",
    toolName: "run_command",
    title: "Run command",
    status: "ok",
    detailsHidden: true,
  });

  const text = await readSseUntilData(reader);
  assert.match(text, /event: message/);
  assert.match(text, /"type":"tool_finished"/);
  assert.match(text, /"detailsHidden":true/);
  assert.equal(text.includes("sk-"), false);
  controller.abort();
});

async function readSseUntilData(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
    if (text.includes("data:")) {
      return text;
    }
  }
  throw new Error(`Timed out waiting for SSE data. Received: ${text}`);
}
