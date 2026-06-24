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

test("plan target mode writes a markdown plan document only under the configured plan directory", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-plan-file-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const planDirectory = path.join(dir, ".agent", "plans");
  const store = new MemoryAgentStore();
  let observedToolCount = -1;
  let observedSystemPrompt = "";
  let toolExecuted = false;
  const model: ModelClient = {
    async complete(request) {
      observedToolCount = request.tools.length;
      observedSystemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
      return {
        type: "message",
        content: "Plan:\n1. Inspect the TUI renderer.\n2. Update the layout.\n3. Verify with smoke tests.",
      };
    },
  };
  const options = {
    model,
    tools: [
      {
        name: "dangerous_write",
        description: "Should never run in plan mode.",
        inputSchema: {},
        handler: async () => {
          toolExecuted = true;
          return { callId: "dangerous_write", ok: true };
        },
      },
    ],
    systemPrompt: "system",
    store,
    actor: { type: "user" as const, id: "planner", displayName: "Planner" },
    targetMode: "plan" as const,
    planDirectory,
  } as ConstructorParameters<typeof AgentLoop>[0] & { planDirectory: string };
  const agent = new AgentLoop(options);

  const result = await agent.runWithSession("make the TUI simpler");
  const planPath = (result as typeof result & { planPath?: string }).planPath;

  assert.equal(observedToolCount, 0);
  assert.equal(toolExecuted, false);
  assert.match(observedSystemPrompt, /only file/i);
  assert.match(observedSystemPrompt, /\.agent[\\/]+plans/i);
  assert(planPath);
  assert.equal(path.dirname(planPath), planDirectory);
  assert.equal(path.extname(planPath), ".md");
  const planFiles = await fs.readdir(planDirectory);
  assert.deepEqual(planFiles, [path.basename(planPath)]);
  const planText = await fs.readFile(planPath, "utf8");
  assert.match(planText, /# Plan:/);
  assert.match(planText, /make the TUI simpler/);
  assert.match(planText, /Inspect the TUI renderer/);
  const topLevelFiles = await fs.readdir(dir);
  assert.deepEqual(topLevelFiles, [".agent"]);
});

test("goal_updated events project safe goal progress", () => {
  const event: AgentRunEvent = {
    type: "goal_updated",
    runId: "run_goal",
    sessionId: "sess_goal",
    goalId: "goal_test",
    status: "complete",
    objective: "ship without exposing sk-testsecretvalue1234567890",
    summary: "verified with sk-testsecretvalue1234567890",
    modelCalls: 3,
    tokenUsed: 42,
  };

  const messages = projectAgentRunEventsToAssistantMessages([event]);
  const projectedJson = JSON.stringify(messages);

  assert.equal(messages[0]?.parts[0]?.type, "status");
  assert.equal(projectedJson.includes("sk-testsecretvalue1234567890"), false);
  assert.match(projectedJson, /\[REDACTED:api_key\]/);
});

test("agent loop emits run budget checkpoints before runtime stops", async () => {
  const events: AgentRunEvent[] = [];
  const model: ModelClient = {
    async complete() {
      return {
        type: "tool_calls",
        content: "continue",
        toolCalls: [{ id: "call_missing", name: "missing_tool", input: {} }],
      };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system",
    maxSteps: 1,
    onProgress: (event) => {
      events.push(event as AgentRunEvent);
    },
  });

  await agent.run("force a budget stop");

  const checkpoint = events.find((event) => (event.type as string) === "run_budget_checkpoint") as
    | {
        steps: number;
        modelCalls: number;
        maxSteps?: number;
        targetMode?: string;
      }
    | undefined;
  assert(checkpoint);
  assert.equal(checkpoint.steps, 1);
  assert.equal(checkpoint.modelCalls, 1);
  assert.equal(checkpoint.maxSteps, 1);
  assert.equal(checkpoint.targetMode, "build");
  assert.equal(events.some((event) => event.type === "runtime_stopped" && event.stopKind === "step_budget"), true);
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
    if ("runId" in event) {
      events.push(event);
    }
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

test("web API streams control-plane heartbeat events through SSE", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-control-event-sse-"));
  const eventBus = new LocalEventBus();
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token", eventBus });
  const healthResponse = await fetch(`${server.baseUrl}/api/health`, {
    headers: { "x-agent-control-token": "test-token" },
  });
  const health = await healthResponse.json() as { localAgentId?: string };
  assert(health.localAgentId);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${server.baseUrl}/api/events`, {
    headers: { "x-agent-control-token": "test-token" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader);
  try {
    const heartbeat = await fetch(`${server.baseUrl}/api/agents/${encodeURIComponent(health.localAgentId)}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
      body: JSON.stringify({
        actor: `agent:${health.localAgentId}`,
        status: "online",
        ttlSeconds: 60,
      }),
    });
    assert.equal(heartbeat.status, 200);

    const text = await readSseUntilData(reader, 2_000);
    assert.match(text, /event: message/);
    assert.match(text, /"type":"control_plane.action"/);
    assert.match(text, /"summary":"Agent heartbeat from control plane"/);
    assert.match(text, /"agentId":"[^"]+"/);
    assert.equal(text.includes("test-token"), false);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
});

test("web API filters control-plane SSE events by room and agent", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-control-event-room-filter-"));
  const eventBus = new LocalEventBus();
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token", eventBus });

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${server.baseUrl}/api/events?room=room_target&agent=agent_target`, {
    headers: { "x-agent-control-token": "test-token" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader);
  try {
    eventBus.publish({
      id: "evt_wrong_room",
      type: "control_plane.action",
      scope: { roomId: "room_other", agentId: "agent_target" },
      payload: { summary: "wrong room" },
      createdAt: "2026-06-21T00:00:00.000Z",
    });
    eventBus.publish({
      id: "evt_wrong_agent",
      type: "control_plane.action",
      scope: { roomId: "room_target", agentId: "agent_other" },
      payload: { summary: "wrong agent" },
      createdAt: "2026-06-21T00:00:01.000Z",
    });
    eventBus.publish({
      id: "evt_matching_room_agent",
      type: "control_plane.action",
      scope: { roomId: "room_target", agentId: "agent_target" },
      payload: { summary: "matching remote heartbeat" },
      createdAt: "2026-06-21T00:00:02.000Z",
    });

    const text = await readSseUntilData(reader, 2_000);
    assert.match(text, /evt_matching_room_agent/);
    assert.doesNotMatch(text, /evt_wrong_room|evt_wrong_agent/);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
});

test("web API streams room message events through room-scoped SSE without message body", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-room-message-event-sse-"));
  const eventBus = new LocalEventBus();
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const setupPlatform = await createLocalPlatform(dir, { provider: "mock", workspaceSnapshot: false });
  const owner = { type: "agent" as const, id: setupPlatform.localAgent.id, displayName: setupPlatform.localAgent.displayName };
  const room = await setupPlatform.rooms.createRoom({
    name: "Room Message SSE",
    createdBy: owner,
    policy: { joinPolicy: "manual", defaultCapabilities: ["room.message.send"] },
  });
  setupPlatform.locks.close?.();
  setupPlatform.store.close();
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token", eventBus });

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${server.baseUrl}/api/events?room=${encodeURIComponent(room.id)}&type=room.message.sent`, {
    headers: { "x-agent-control-token": "test-token" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader);
  try {
    const messageBody = "@agent:agent_target hello from room event stream phase5-control-token";
    const messageResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
      body: JSON.stringify({
        actor: `agent:${owner.id}`,
        kind: "chat",
        body: messageBody,
      }),
    });
    assert.equal(messageResponse.status, 200);
    const messagePayload = await messageResponse.json() as { message?: { id?: string } };
    assert.ok(messagePayload.message?.id);

    const text = await readSseUntilData(reader, 2_000);
    assert.match(text, /event: message/);
    assert.match(text, /"type":"room.message.sent"/);
    assert.match(text, new RegExp(`"messageId":"${messagePayload.message.id}"`));
    assert.match(text, /"kind":"chat"/);
    assert.match(text, /"senderId":"[^"]+"/);
    assert.match(text, /"bodyLength":\d+/);
    assert.doesNotMatch(text, /phase5-control-token|hello from room event stream/);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
});

test("web API streams room delivery ack events through room-scoped SSE without ack signature", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-room-ack-event-sse-"));
  const eventBus = new LocalEventBus();
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const setupPlatform = await createLocalPlatform(dir, { provider: "mock", workspaceSnapshot: false });
  const owner = { type: "agent" as const, id: setupPlatform.localAgent.id, displayName: setupPlatform.localAgent.displayName };
  const room = await setupPlatform.rooms.createRoom({
    name: "Room Ack SSE",
    createdBy: owner,
    policy: { joinPolicy: "manual", defaultCapabilities: ["room.message.send", "room.delivery.ack"] },
  });
  setupPlatform.locks.close?.();
  setupPlatform.store.close();
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token", eventBus });

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${server.baseUrl}/api/events?room=${encodeURIComponent(room.id)}&type=room.delivery.acknowledged`, {
    headers: { "x-agent-control-token": "test-token" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader);
  try {
    const messageResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
      body: JSON.stringify({
        actor: `agent:${owner.id}`,
        kind: "task",
        body: `@agent:${owner.id} ack event smoke phase5-control-token`,
      }),
    });
    assert.equal(messageResponse.status, 200);
    const messagePayload = await messageResponse.json() as { message?: { id?: string } };
    assert.ok(messagePayload.message?.id);

    const ackResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/agent-inbox/ack`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
      body: JSON.stringify({
        actor: `agent:${owner.id}`,
        agentId: owner.id,
        messageId: messagePayload.message.id,
      }),
    });
    assert.equal(ackResponse.status, 200);

    const text = await readSseUntilData(reader, 2_000);
    assert.match(text, /event: message/);
    assert.match(text, /"type":"room.delivery.acknowledged"/);
    assert.match(text, new RegExp(`"messageId":"${messagePayload.message.id}"`));
    assert.match(text, new RegExp(`"agentId":"${owner.id}"`));
    assert.match(text, /"signedAck":true/);
    assert.doesNotMatch(text, /phase5-control-token|ack event smoke|ed25519|signature|nonce/);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
});

test("web API summarizes per-agent room delivery status without transcript bodies or ack envelopes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-room-delivery-status-"));
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const setupPlatform = await createLocalPlatform(dir, { provider: "mock", workspaceSnapshot: false });
  const owner = { type: "user" as const, id: "owner", displayName: "Owner" };
  const room = await setupPlatform.rooms.createRoom({
    name: "Room Delivery Status",
    createdBy: owner,
    policy: {
      joinPolicy: "manual",
      defaultCapabilities: ["room.message.send"],
      agentResponseMode: "mentions_only",
    },
  });
  await setupPlatform.store.addRoomMember({
    roomId: room.id,
    actor: { type: "agent", id: "agent_alpha", displayName: "Alpha" },
    role: "executor",
    status: "active",
    joinedAt: new Date().toISOString(),
  });
  await setupPlatform.store.addRoomMember({
    roomId: room.id,
    actor: { type: "agent", id: "agent_beta", displayName: "Beta" },
    role: "executor",
    status: "active",
    joinedAt: new Date().toISOString(),
  });
  setupPlatform.locks.close?.();
  setupPlatform.store.close();
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token" });

  const alphaResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
    body: JSON.stringify({
      actor: "user:owner",
      kind: "task",
      body: "@agent:agent_alpha alpha secret phase5-control-token",
    }),
  });
  assert.equal(alphaResponse.status, 200);
  const alphaPayload = await alphaResponse.json() as { message?: { id?: string } };
  assert.ok(alphaPayload.message?.id);

  const betaResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
    body: JSON.stringify({
      actor: "user:owner",
      kind: "task",
      body: "@agent:agent_beta beta secret phase5-control-token",
    }),
  });
  assert.equal(betaResponse.status, 200);
  const betaPayload = await betaResponse.json() as { message?: { id?: string } };
  assert.ok(betaPayload.message?.id);

  const ackResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/agent-inbox/ack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
    body: JSON.stringify({
      actor: "user:owner",
      agentId: "agent_alpha",
      messageId: alphaPayload.message.id,
    }),
  });
  assert.equal(ackResponse.status, 200);

  const statusResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/delivery-status`, {
    headers: { "x-agent-control-token": "test-token" },
  });
  assert.equal(statusResponse.status, 200);
  const statusText = await statusResponse.text();
  assert.doesNotMatch(statusText, /phase5-control-token|alpha secret|beta secret|signature|nonce|ackEnvelope/i);
  const status = JSON.parse(statusText) as {
    roomId?: string;
    transcriptMessageCount?: number;
    agents?: Array<{
      agentId?: string;
      displayName?: string;
      memberStatus?: string;
      role?: string;
      routedMessageCount?: number;
      pendingRoutedCount?: number;
      lastRoutedMessageId?: string;
      lastAckMessageId?: string;
      lastAckSigned?: boolean;
    }>;
  };
  assert.equal(status.roomId, room.id);
  assert.equal(status.transcriptMessageCount, 2);
  const agents = new Map((status.agents ?? []).map((agent) => [agent.agentId, agent]));
  assert.equal(agents.get("agent_alpha")?.displayName, "Alpha");
  assert.equal(agents.get("agent_alpha")?.memberStatus, "active");
  assert.equal(agents.get("agent_alpha")?.role, "executor");
  assert.equal(agents.get("agent_alpha")?.routedMessageCount, 1);
  assert.equal(agents.get("agent_alpha")?.pendingRoutedCount, 0);
  assert.equal(agents.get("agent_alpha")?.lastRoutedMessageId, alphaPayload.message.id);
  assert.equal(agents.get("agent_alpha")?.lastAckMessageId, alphaPayload.message.id);
  assert.equal(agents.get("agent_alpha")?.lastAckSigned, false);
  assert.equal(agents.get("agent_beta")?.routedMessageCount, 1);
  assert.equal(agents.get("agent_beta")?.pendingRoutedCount, 1);
  assert.equal(agents.get("agent_beta")?.lastRoutedMessageId, betaPayload.message.id);
  assert.equal(agents.get("agent_beta")?.lastAckMessageId, undefined);

  const stateResponse = await fetch(`${server.baseUrl}/api/state`, {
    headers: { "x-agent-control-token": "test-token" },
  });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json() as {
    rooms?: Array<{
      room?: { id?: string };
      deliveryStatus?: {
        roomId?: string;
        transcriptMessageCount?: number;
        agents?: Array<{
          agentId?: string;
          pendingRoutedCount?: number;
          lastAckMessageId?: string;
          lastAckSigned?: boolean;
        }>;
      };
    }>;
  };
  const stateRoom = state.rooms?.find((candidate) => candidate.room?.id === room.id);
  assert.ok(stateRoom?.deliveryStatus);
  const stateDeliveryText = JSON.stringify(stateRoom.deliveryStatus);
  assert.doesNotMatch(stateDeliveryText, /phase5-control-token|alpha secret|beta secret|signature|nonce|ackEnvelope/i);
  assert.equal(stateRoom.deliveryStatus.roomId, room.id);
  assert.equal(stateRoom.deliveryStatus.transcriptMessageCount, 2);
  const stateAgents = new Map((stateRoom.deliveryStatus.agents ?? []).map((agent) => [agent.agentId, agent]));
  assert.equal(stateAgents.get("agent_alpha")?.pendingRoutedCount, 0);
  assert.equal(stateAgents.get("agent_alpha")?.lastAckMessageId, alphaPayload.message.id);
  assert.equal(stateAgents.get("agent_alpha")?.lastAckSigned, false);
  assert.equal(stateAgents.get("agent_beta")?.pendingRoutedCount, 1);
  assert.equal(stateAgents.get("agent_beta")?.lastAckMessageId, undefined);

  const htmlResponse = await fetch(`${server.baseUrl}/?token=test-token`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /Delivery Status/);
  assert.match(html, /id="delivery-status"/);
});

test("web API creates a remote room invite bundle without persisting invite secrets", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-web-room-invite-bundle-"));
  let server: Awaited<ReturnType<typeof startLocalRoomWebServer>> | undefined;
  t.after(async () => {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const setupPlatform = await createLocalPlatform(dir, { provider: "mock", workspaceSnapshot: false });
  const owner = { type: "agent" as const, id: setupPlatform.localAgent.id, displayName: setupPlatform.localAgent.displayName };
  const room = await setupPlatform.rooms.createRoom({
    name: "Web Remote Invite Bundle",
    createdBy: owner,
    policy: {
      joinPolicy: "invite_token",
      defaultCapabilities: ["room.message.send"],
      requireSignedInvites: true,
    },
  });
  setupPlatform.locks.close?.();
  setupPlatform.store.close();
  server = await startLocalRoomWebServer(dir, { port: 0, token: "test-token" });

  const inviteResponse = await fetch(`${server.baseUrl}/api/rooms/${encodeURIComponent(room.id)}/invite-bundle`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-control-token": "test-token" },
    body: JSON.stringify({
      actor: `agent:${owner.id}`,
      controlUrl: "http://control.example.test:4317",
      alias: "linux-builder",
      displayName: "Linux Builder",
      role: "executor",
      ttlHours: 12,
      maxUses: 1,
    }),
  });
  assert.equal(inviteResponse.status, 200);
  const inviteText = await inviteResponse.text();
  const invitePayload = JSON.parse(inviteText) as {
    bundle?: {
      kind?: string;
      version?: number;
      controlUrl?: string;
      controlToken?: string;
      roomId?: string;
      inviteToken?: string;
      inviteId?: string;
      inviteSignatureStatus?: string;
      role?: string;
      aliases?: string[];
      displayName?: string;
      sensitivity?: string;
      commands?: { enroll?: string; run?: string };
    };
    fileName?: string;
    warning?: string;
  };
  const bundle = invitePayload.bundle;
  assert.equal(bundle?.kind, "soloclaw.room_invite");
  assert.equal(bundle?.version, 1);
  assert.equal(bundle?.controlUrl, "http://control.example.test:4317");
  assert.equal(bundle?.controlToken, "test-token");
  assert.equal(bundle?.roomId, room.id);
  assert.match(bundle?.inviteToken ?? "", /^rinv_/);
  assert.match(bundle?.inviteId ?? "", /^rinv_/);
  assert.equal(bundle?.inviteSignatureStatus, "valid");
  assert.equal(bundle?.role, "executor");
  assert.deepEqual(bundle?.aliases, ["linux-builder"]);
  assert.equal(bundle?.displayName, "Linux Builder");
  assert.match(bundle?.sensitivity ?? "", /contains_control_token_and_invite_token/);
  assert.match(bundle?.commands?.enroll ?? "", /room join --invite-bundle room-invite\.json --json/);
  assert.match(bundle?.commands?.run ?? "", /room join --invite-bundle room-invite\.json --run/);
  assert.equal(invitePayload.fileName, "room-invite.json");
  assert.match(invitePayload.warning ?? "", /Do not commit/i);
  assert.doesNotMatch(inviteText, /BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY|ackEnvelope|messageEnvelope/i);

  const stateResponse = await fetch(`${server.baseUrl}/api/state`, {
    headers: { "x-agent-control-token": "test-token" },
  });
  assert.equal(stateResponse.status, 200);
  const stateText = await stateResponse.text();
  assert.doesNotMatch(stateText, new RegExp(bundle?.inviteToken ?? "rinv_unset"));
  assert.doesNotMatch(stateText, /test-token|control.example.test/);
  assert.match(stateText, new RegExp(bundle?.inviteId ?? "rinv_unset"));

  const auditResponse = await fetch(`${server.baseUrl}/api/audit?type=control_plane.action`, {
    headers: { "x-agent-control-token": "test-token" },
  });
  assert.equal(auditResponse.status, 200);
  const auditText = await auditResponse.text();
  assert.match(auditText, /Created remote room invite bundle from control plane/);
  assert.match(auditText, new RegExp(bundle?.inviteId ?? "rinv_unset"));
  assert.doesNotMatch(auditText, new RegExp(bundle?.inviteToken ?? "rinv_unset"));
  assert.doesNotMatch(auditText, /test-token|control.example.test/);

  const htmlResponse = await fetch(`${server.baseUrl}/?token=test-token`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /Invite Remote Agent/);
  assert.match(html, /id="invite-bundle-output"/);
});

async function readSseUntilData(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 5_000): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), remainingMs)),
    ]);
    if ("timedOut" in result) {
      break;
    }
    const { value, done } = result;
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
    if (text.includes("data:")) {
      return text;
    }
  }
  throw new Error(`Timed out waiting for SSE data. Received: ${JSON.stringify(text)}`);
}
