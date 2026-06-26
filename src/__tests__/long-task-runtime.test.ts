import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../core/agent-loop.js";
import { AgentRunSupervisor } from "../core/agent-run-supervisor.js";
import type { ModelClient } from "../model/model-client.js";
import { TaskAssignmentService } from "../tasks/task-assignment-service.js";
import { MemoryAgentStore } from "../store/memory-agent-store.js";
import { LocalWorkerRunner } from "../workers/local-worker-runner.js";
import { WorkerRegistryService } from "../workers/worker-registry-service.js";

test("goal supervisor auto-continues stopped chunks until complete", async () => {
  const store = new MemoryAgentStore();
  let calls = 0;
  const model: ModelClient = {
    async complete() {
      calls += 1;
      if (calls <= 6) {
        return {
          type: "tool_calls",
          content: `chunk progress ${calls}`,
          toolCalls: [{ id: `call_chunk_${calls}`, name: "progress_marker", input: { turn: calls } }],
        };
      }
      return { type: "message", content: "goal complete after continuations" };
    },
  };
  const createAgent = () =>
    new AgentLoop({
      model,
      tools: [
        {
          name: "progress_marker",
          description: "Records safe progress.",
          inputSchema: {},
          handler: async (input) => ({ callId: `call_chunk_${String(input.turn ?? "unknown")}`, ok: true, output: "ok" }),
        },
      ],
      systemPrompt: "system",
      store,
      actor: { type: "user", id: "goal-supervisor-user", displayName: "Goal Supervisor User" },
      targetMode: "goal",
      maxSteps: 3,
    });
  const supervisor = new AgentRunSupervisor({ store, createAgent });

  const result = await supervisor.run({
    objective: "finish across chunks",
    autoContinue: true,
    maxContinuations: 5,
  });

  assert.equal(result.status, "complete");
  assert.match(result.finalAnswer, /goal complete after continuations/);
  assert.equal(result.continuations, 2);
  assert(result.sessionId);
  const goal = await store.getGoalRunBySession(result.sessionId);
  assert.equal(goal?.status, "complete");
});

test("local worker runner keeps resumable goal runtime stops leased for continuation", async () => {
  const store = new MemoryAgentStore();
  const workers = new WorkerRegistryService(store);
  const assignments = new TaskAssignmentService(store);
  const actor = { type: "agent" as const, id: "agent-worker", displayName: "Agent Worker" };
  const session = await store.createSession({
    objective: "runner stops on resumable goal budget",
    status: "created",
    targetMode: "goal",
    risk: "medium",
    projectId: "project-local",
    createdBy: actor,
  });
  const worker = await workers.register({
    actor,
    agentId: actor.id,
    machineId: "machine-local",
    allowedProjects: ["project-local"],
    ttlSeconds: 60,
  });
  const assigned = await assignments.assign({ actor, workerId: worker.id, sessionId: session.id, leaseTtlSeconds: 60 });
  const runner = new LocalWorkerRunner({
    store,
    workers,
    assignments,
    createAgent: () =>
      ({
        resume: async (sessionId: string) => {
          assert.equal(sessionId, session.id);
          await store.updateSessionStatus(sessionId, "failed");
          await store.recordAuditEvent({
            id: "audit_resumable_runtime_stop" as never,
            type: "agent.event",
            actor,
            sessionId,
            summary: "agent.event.runtime_stopped",
            metadata: {
              eventType: "runtime_stopped",
              stopKind: "step_budget",
              targetMode: "goal",
              reason: "The run reached the configured step budget.",
              resumeCommand: `agent resume ${sessionId}`,
            },
            artifactRefs: [],
            createdAt: new Date().toISOString(),
          });
          return `Stopped after 3 steps without a final answer.\nsession: ${sessionId}\nresume: agent resume ${sessionId}`;
        },
      }) as unknown as AgentLoop,
  });

  const result = await runner.runOnce({ workerId: worker.id, leaseTtlSeconds: 60, actor });

  assert.equal(result.ran, true);
  assert.equal(result.ran ? result.completed : true, false);
  assert.equal((await assignments.get(assigned.id))?.status, "running");
  assert.equal((await store.getSession(session.id))?.status, "failed");
  assert.equal((await store.getWorkerRegistration(worker.id))?.currentLoad, 1);
  assert.equal((await store.listAuditEvents({ type: "task.completed" })).length, 0);
});
