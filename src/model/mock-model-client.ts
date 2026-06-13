import type { ModelClient, ModelRequest } from "./model-client.js";
import type { ModelResponse } from "../protocol/types.js";

export class MockModelClient implements ModelClient {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.tools.length === 0) {
      return {
        type: "message",
        content:
          "Plan:\n1. Inspect the relevant workspace context.\n2. Identify the files and risks involved.\n3. Make the smallest scoped change.\n4. Run verification and report the result.",
      };
    }

    const repairResponse = mockRepairFailingSampleTest(request);
    if (repairResponse) {
      return repairResponse;
    }

    const hasListedFiles = request.messages.some(
      (message) => message.role === "tool" && message.toolResult.callId === "mock-list-files",
    );

    if (!hasListedFiles) {
      return {
        type: "tool_calls",
        content: "I will inspect the workspace first.",
        toolCalls: [
          {
            id: "mock-list-files",
            name: "list_files",
            input: { path: "." },
          },
        ],
      };
    }

    return {
      type: "message",
      content:
        "Blueprint agent loop is working. Next step: replace MockModelClient with a real provider and add approval checks for write/shell tools.",
    };
  }
}

function mockRepairFailingSampleTest(request: ModelRequest): ModelResponse | undefined {
  const userText = request.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();
  const tools = new Set(request.tools.map((tool) => tool.name));
  if (!userText.includes("repair failing sample test") || !tools.has("run_command") || !tools.has("apply_patch")) {
    return undefined;
  }

  const initialTest = toolResult(request, "mock-repair-initial-test");
  if (!initialTest) {
    return {
      type: "tool_calls",
      content: "I will reproduce the failing test before changing the code.",
      toolCalls: [
        {
          id: "mock-repair-initial-test",
          name: "run_command",
          input: { command: "node test/math.test.js", timeoutMs: 20_000 },
        },
      ],
    };
  }

  const patch = toolResult(request, "mock-repair-apply-patch");
  if (!patch) {
    return {
      type: "tool_calls",
      content: "The test failed, so I will apply the focused math fix.",
      toolCalls: [
        {
          id: "mock-repair-apply-patch",
          name: "apply_patch",
          input: { patch: mockRepairPatch() },
        },
      ],
    };
  }

  const recoveredTest = toolResult(request, "mock-repair-recovered-test");
  if (!recoveredTest) {
    return {
      type: "tool_calls",
      content: "I will rerun the test after the patch.",
      toolCalls: [
        {
          id: "mock-repair-recovered-test",
          name: "run_command",
          input: { command: "node test/math.test.js", timeoutMs: 20_000 },
        },
      ],
    };
  }

  const recovered = recoveredTest.output?.includes("exit=0") === true;
  return {
    type: "message",
    content: recovered
      ? "Repaired the failing sample test: reproduced the failure, patched src/math.js, and reran the test successfully."
      : "Attempted the sample repair, but the final verification command did not pass.",
  };
}

function toolResult(request: ModelRequest, callId: string) {
  for (const message of request.messages) {
    if (message.role === "tool" && message.toolResult.callId === callId) {
      return message.toolResult;
    }
  }
  return undefined;
}

function mockRepairPatch(): string {
  return [
    "diff --git a/src/math.js b/src/math.js",
    "--- a/src/math.js",
    "+++ b/src/math.js",
    "@@ -1,3 +1,3 @@",
    " export function add(a, b) {",
    "-  return a - b;",
    "+  return a + b;",
    " }",
    "",
  ].join("\n");
}
