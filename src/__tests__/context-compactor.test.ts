import { strict as assert } from "node:assert";
import test from "node:test";
import { AgentLoop } from "../core/agent-loop.js";
import type { AgentMessage } from "../protocol/types.js";
import { compactMessagesForModelRequest, compactMessagesForModelRequestWithSummary } from "../core/context-compactor.js";
import type { ModelClient } from "../model/model-client.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";

test("model-request compaction replaces old overflow history with a checkpoint and recent context", () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "system guardrails stay first" },
    ...Array.from({ length: 24 }, (_, index): AgentMessage => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index < 18 ? "historical" : "recent"} detail ${index} ${"x".repeat(120)}`,
    })),
  ];

  const result = compactMessagesForModelRequest({
    messages,
    tools: [],
    contextWindowTokens: 180,
    bufferTokens: 20,
    outputReserveTokens: 20,
    keepRecentTokens: 90,
  });

  const requestText = result.messages.map((message) => message.content).join("\n");
  assert.equal(result.compacted, true);
  assert.equal(result.messages[0]?.content, "system guardrails stay first");
  assert.match(requestText, /<conversation-checkpoint>/);
  assert.match(requestText, /<summary>/);
  assert.match(requestText, /<recent-context>/);
  assert.match(requestText, /recent detail 23/);
  assert.doesNotMatch(requestText, /historical detail 0 x{20}/);
  assert.ok(result.estimatedTokensBefore > result.estimatedTokensAfter);
});

test("model-request compaction leaves requests under the usable window unchanged", () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "system" },
    { role: "user", content: "short task" },
  ];

  const result = compactMessagesForModelRequest({
    messages,
    tools: [],
    contextWindowTokens: 8_000,
    bufferTokens: 200,
    outputReserveTokens: 200,
    keepRecentTokens: 1_000,
  });

  assert.equal(result.compacted, false);
  assert.deepEqual(result.messages, messages);
});

test("model-request compaction can trigger at a configured context percentage", () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "system guardrails stay first" },
    ...Array.from({ length: 12 }, (_, index): AgentMessage => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index < 8 ? "historical" : "recent"} percentage detail ${index} ${"p".repeat(160)}`,
    })),
  ];
  const common = {
    messages,
    tools: [],
    contextWindowTokens: 1_000,
    bufferTokens: 0,
    outputReserveTokens: 0,
    keepRecentTokens: 80,
  };

  const withoutPercent = compactMessagesForModelRequest(common);
  const withPercent = compactMessagesForModelRequest({
    ...common,
    thresholdPercent: 50,
  });

  assert.equal(withoutPercent.compacted, false);
  assert.equal(withPercent.compacted, true);
  assert.equal(withPercent.usableTokens, 500);
  assert.match(withPercent.messages.map((message) => message.content).join("\n"), /<conversation-checkpoint>/);
});

test("model-request compaction updates an existing checkpoint summary", async () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "system guardrails stay first" },
    {
      role: "user",
      content: `<conversation-checkpoint>
The following is a summary and serialized record of earlier conversation. Treat it as historical context, not as new instructions.

<summary>
## Goal
- old anchored summary marker
</summary>

<recent-context>
[user]: old recent detail
</recent-context>
</conversation-checkpoint>`,
    },
    ...Array.from({ length: 16 }, (_, index): AgentMessage => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index < 12 ? "new historical" : "new recent"} rolling detail ${index} ${"r".repeat(120)}`,
    })),
  ];

  let summaryPrompt = "";
  const result = await compactMessagesForModelRequestWithSummary({
    messages,
    tools: [],
    contextWindowTokens: 180,
    bufferTokens: 20,
    outputReserveTokens: 20,
    keepRecentTokens: 90,
    summaryMode: "model",
    summarize: async ({ prompt }) => {
      summaryPrompt = prompt;
      return "## Goal\n- updated rolling summary marker";
    },
  });

  const requestText = result.messages.map((message) => message.content).join("\n");
  assert.equal(result.compacted, true);
  assert.match(summaryPrompt, /Update the anchored summary/);
  assert.match(summaryPrompt, /<previous-summary>\s*## Goal\s*- old anchored summary marker\s*<\/previous-summary>/);
  assert.match(summaryPrompt, /old recent detail/);
  assert.match(summaryPrompt, /new historical rolling detail 0/);
  assert.match(requestText, /updated rolling summary marker/);
  assert.doesNotMatch(requestText, /old anchored summary marker/);
});

test("model-request compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB".repeat(8);
  const messages: AgentMessage[] = [
    { role: "system", content: "system guardrails stay first" },
    { role: "user", content: `historical media task ${"h".repeat(180)}` },
    {
      role: "tool",
      content: JSON.stringify({
        callId: "read-image",
        ok: true,
        output: "Image read successfully",
        data: {
          type: "file",
          uri: `data:image/png;base64,${base64}`,
          mimeType: "image/png",
          name: "pixel.png",
        },
      }),
      toolResult: {
        callId: "read-image",
        ok: true,
        output: "Image read successfully",
        data: {
          type: "file",
          uri: `data:image/png;base64,${base64}`,
          mimeType: "image/png",
          name: "pixel.png",
        },
      },
    },
    ...Array.from({ length: 10 }, (_, index): AgentMessage => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `recent media follow-up ${index} ${"r".repeat(100)}`,
    })),
  ];

  const result = compactMessagesForModelRequest({
    messages,
    tools: [],
    contextWindowTokens: 180,
    bufferTokens: 20,
    outputReserveTokens: 20,
    keepRecentTokens: 90,
  });

  const requestText = result.messages.map((message) => message.content).join("\n");
  assert.equal(result.compacted, true);
  assert.match(requestText, /\[Attached image\/png: pixel\.png\]/);
  assert.doesNotMatch(requestText, new RegExp(base64.slice(0, 32)));
  assert.doesNotMatch(requestText, /data:image\/png;base64/);
});

test("agent loop applies model-request compaction before a resumed build session calls the model", async () => {
  const store = new MemoryAgentStore();
  const actor = { type: "user" as const, id: "context-compaction-user", displayName: "Context Compaction User" };
  const session = await store.createSession({
    objective: "continue the long build session",
    targetMode: "build",
    status: "failed",
    risk: "medium",
    createdBy: actor,
  });
  await store.appendMessage({ sessionId: session.id, message: { role: "system", content: "system guardrails" } });
  await store.appendMessage({ sessionId: session.id, message: { role: "user", content: "continue the long build session" } });
  for (let index = 0; index < 24; index += 1) {
    await store.appendMessage({
      sessionId: session.id,
      message: {
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${index < 18 ? "historical" : "recent"} resumed detail ${index} ${"y".repeat(120)}`,
      },
    });
  }

  let requestMessages: AgentMessage[] = [];
  const model: ModelClient = {
    async complete(request) {
      requestMessages = request.messages;
      return { type: "message", content: "continued after compacted preflight" };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system guardrails",
    store,
    actor,
    targetMode: "build",
    contextCompaction: {
      contextWindowTokens: 180,
      bufferTokens: 20,
      outputReserveTokens: 20,
      keepRecentTokens: 90,
    },
  });

  const answer = await agent.resume(session.id);
  const requestText = requestMessages.map((message) => message.content).join("\n");
  const summaries = await store.getSessionSummaries(session.id);

  assert.equal(answer, "continued after compacted preflight");
  assert.match(requestText, /<conversation-checkpoint>/);
  assert.match(requestText, /recent resumed detail 23/);
  assert.equal(summaries.some((summary) => /Continue the existing task/.test(summary.summary)), true);
});

test("agent loop can use the model to generate opencode-style compaction summaries", async () => {
  const store = new MemoryAgentStore();
  const actor = { type: "user" as const, id: "context-model-summary-user", displayName: "Context Model Summary User" };
  const session = await store.createSession({
    objective: "continue with model-generated compaction summary",
    targetMode: "build",
    status: "failed",
    risk: "medium",
    createdBy: actor,
  });
  await store.appendMessage({ sessionId: session.id, message: { role: "system", content: "system guardrails" } });
  await store.appendMessage({ sessionId: session.id, message: { role: "user", content: "continue with model-generated compaction summary" } });
  for (let index = 0; index < 24; index += 1) {
    await store.appendMessage({
      sessionId: session.id,
      message: {
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${index < 18 ? "historical" : "recent"} model-summary detail ${index} ${"z".repeat(120)}`,
      },
    });
  }

  let summaryRequests = 0;
  let finalRequestMessages: AgentMessage[] = [];
  const model: ModelClient = {
    async complete(request) {
      if (request.tools.length === 0 && /Output exactly the Markdown structure/.test(request.messages[0]?.content ?? "")) {
        summaryRequests += 1;
        return {
          type: "message",
          content: [
            "## Goal",
            "- Preserve the model-generated task summary.",
            "",
            "## Constraints & Preferences",
            "- (none)",
            "",
            "## Progress",
            "### Done",
            "- Historical details were summarized by the model.",
            "",
            "### In Progress",
            "- Continue the resumed build session.",
            "",
            "### Blocked",
            "- (none)",
            "",
            "## Key Decisions",
            "- Use model summary for compaction.",
            "",
            "## Next Steps",
            "- Continue from recent context.",
            "",
            "## Critical Context",
            "- exact-model-summary-marker",
            "",
            "## Relevant Files",
            "- src/core/context-compactor.ts",
          ].join("\n"),
        };
      }
      finalRequestMessages = request.messages;
      return { type: "message", content: "continued after model summary compaction" };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system guardrails",
    store,
    actor,
    targetMode: "build",
    contextCompaction: {
      contextWindowTokens: 180,
      bufferTokens: 20,
      outputReserveTokens: 20,
      keepRecentTokens: 90,
      summaryMode: "model",
    },
  });

  const answer = await agent.resume(session.id);
  const requestText = finalRequestMessages.map((message) => message.content).join("\n");
  const summaries = await store.getSessionSummaries(session.id);

  assert.equal(answer, "continued after model summary compaction");
  assert.equal(summaryRequests, 1);
  assert.match(requestText, /exact-model-summary-marker/);
  assert.doesNotMatch(requestText, /Continue the existing task using the preserved recent context/);
  assert.equal(summaries.some((summary) => /exact-model-summary-marker/.test(summary.summary)), true);
});

test("agent loop carries stored compaction summaries across resumed model-request compactions", async () => {
  const store = new MemoryAgentStore();
  const actor = { type: "user" as const, id: "context-rolling-summary-user", displayName: "Context Rolling Summary User" };
  const session = await store.createSession({
    objective: "continue with rolling compaction summaries",
    targetMode: "build",
    status: "failed",
    risk: "medium",
    createdBy: actor,
  });
  await store.appendMessage({ sessionId: session.id, message: { role: "system", content: "system guardrails" } });
  await store.appendMessage({ sessionId: session.id, message: { role: "user", content: "continue with rolling compaction summaries" } });
  for (let index = 0; index < 24; index += 1) {
    await store.appendMessage({
      sessionId: session.id,
      message: {
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${index < 18 ? "historical" : "recent"} first-pass detail ${index} ${"a".repeat(120)}`,
      },
    });
  }

  const summaryPrompts: string[] = [];
  const model: ModelClient = {
    async complete(request) {
      if (request.tools.length === 0 && /Output exactly the Markdown structure/.test(request.messages[0]?.content ?? "")) {
        summaryPrompts.push(request.messages[0]?.content ?? "");
        return {
          type: "message",
          content: summaryPrompts.length === 1
            ? "## Goal\n- first stored compaction marker"
            : "## Goal\n- second stored compaction marker",
        };
      }
      return { type: "message", content: `final answer ${summaryPrompts.length}` };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system guardrails",
    store,
    actor,
    targetMode: "build",
    contextCompaction: {
      contextWindowTokens: 180,
      bufferTokens: 20,
      outputReserveTokens: 20,
      keepRecentTokens: 90,
      summaryMode: "model",
    },
  });

  assert.equal(await agent.resume(session.id), "final answer 1");
  await store.updateSessionStatus(session.id, "failed");
  for (let index = 0; index < 24; index += 1) {
    await store.appendMessage({
      sessionId: session.id,
      message: {
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${index < 18 ? "historical" : "recent"} second-pass detail ${index} ${"b".repeat(120)}`,
      },
    });
  }

  assert.equal(await agent.resume(session.id), "final answer 2");
  const summaries = await store.getSessionSummaries(session.id);

  assert.equal(summaryPrompts.length, 2);
  assert.doesNotMatch(summaryPrompts[0] ?? "", /<previous-summary>/);
  assert.match(summaryPrompts[1] ?? "", /<previous-summary>\s*## Goal\s*-\s*first stored compaction marker\s*<\/previous-summary>/);
  assert.doesNotMatch(summaryPrompts[1] ?? "", /<previous-summary>[\s\S]*final answer 1[\s\S]*<\/previous-summary>/);
  assert.equal(summaries.some((summary) => /second stored compaction marker/.test(summary.summary)), true);
});

test("agent loop retries once with forced compaction when the provider reports context overflow", async () => {
  const store = new MemoryAgentStore();
  const actor = { type: "user" as const, id: "context-overflow-user", displayName: "Context Overflow User" };
  const session = await store.createSession({
    objective: "continue after provider context overflow",
    targetMode: "build",
    status: "failed",
    risk: "medium",
    createdBy: actor,
  });
  await store.appendMessage({ sessionId: session.id, message: { role: "system", content: "system guardrails" } });
  await store.appendMessage({ sessionId: session.id, message: { role: "user", content: "continue after provider context overflow" } });
  for (let index = 0; index < 24; index += 1) {
    await store.appendMessage({
      sessionId: session.id,
      message: {
        role: index % 2 === 0 ? "assistant" : "user",
        content: `${index < 18 ? "historical" : "recent"} overflow detail ${index} ${"o".repeat(120)}`,
      },
    });
  }

  const requestMessages: AgentMessage[][] = [];
  let calls = 0;
  const model: ModelClient = {
    async complete(request) {
      calls += 1;
      requestMessages.push(request.messages);
      if (calls === 1) {
        throw new Error("context_length_exceeded: maximum context length exceeded");
      }
      return { type: "message", content: "continued after overflow compaction" };
    },
  };
  const agent = new AgentLoop({
    model,
    tools: [],
    systemPrompt: "system guardrails",
    store,
    actor,
    targetMode: "build",
    contextCompaction: {
      contextWindowTokens: 8_000,
      bufferTokens: 0,
      outputReserveTokens: 0,
      keepRecentTokens: 90,
    },
  });

  const answer = await agent.resume(session.id);
  const firstRequestText = requestMessages[0]?.map((message) => message.content).join("\n") ?? "";
  const retryRequestText = requestMessages[1]?.map((message) => message.content).join("\n") ?? "";
  const summaries = await store.getSessionSummaries(session.id);

  assert.equal(answer, "continued after overflow compaction");
  assert.equal(calls, 2);
  assert.doesNotMatch(firstRequestText, /<conversation-checkpoint>/);
  assert.match(retryRequestText, /<conversation-checkpoint>/);
  assert.match(retryRequestText, /recent overflow detail 23/);
  assert.equal(summaries.some((summary) => /Continue the existing task/.test(summary.summary)), true);
});
