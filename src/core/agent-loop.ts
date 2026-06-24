import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelClient } from "../model/model-client.js";
import type { AgentMessage, ModelResponse, RegisteredTool, ToolCall, ToolDefinition } from "../protocol/types.js";
import type { ActorRef, ExecutionTargetMode, GoalRun, Session } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import { GoalService } from "../goals/goal-service.js";
import { ModelBudgetExceededError } from "../model/guarded-model-client.js";
import type { AgentStore } from "../store/agent-store.js";
import { TaskOperationsService } from "../tasks/task-operations-service.js";
import { redactAgentEventText, summarizeToolInput } from "./agent-event-redaction.js";
import type { AgentRunEvent, AgentRunEventSink } from "./agent-events.js";
import { withEventDefaults } from "./agent-events.js";
import { agentModePolicy } from "./agent-mode-policy.js";
import { formatRuntimeStopAnswer, modelBudgetRuntimeStop } from "./agent-runtime-stop.js";
import {
  compactMessagesForGoal,
  compactMessagesForModelRequestWithSummary,
  formatStoredModelRequestCompactionSummary,
  parseStoredModelRequestCompactionSummary,
} from "./context-compactor.js";
import type { ModelRequestCompactionOptions } from "./context-compactor.js";
import { ContextManager } from "./context-manager.js";
import { DoomLoopDetector } from "./doom-loop-detector.js";
import { createRunBudget, RunBudgetController } from "./run-budget.js";
import type { AgentRunBudget } from "./run-budget.js";

export type AgentContextAttachment = {
  label: string;
  content: string;
};

export type AgentLoopProgressEvent = AgentRunEvent;
type WithoutRunDefaults<T> = T extends unknown ? Omit<T, "runId" | "createdAt"> & { runId?: string; createdAt?: string } : never;
type AgentRunEventInput = WithoutRunDefaults<AgentRunEvent>;

export type AgentLoopOptions = {
  model: ModelClient;
  modelAudit?: {
    provider?: string;
    model?: string;
    fallbackProviders?: string[];
  };
  tools: RegisteredTool[];
  systemPrompt: string;
  maxSteps?: number;
  runBudget?: AgentRunBudget;
  store?: AgentStore;
  actor?: ActorRef;
  contextAttachments?: AgentContextAttachment[];
  contextCompaction?: Omit<ModelRequestCompactionOptions, "messages" | "tools">;
  selectedSkillIds?: string[];
  targetMode?: ExecutionTargetMode;
  planDirectory?: string;
  sessionScope?: Pick<Session, "orgId" | "projectId" | "roomId">;
  onSessionActivated?: (session: Session) => void;
  onProgress?: AgentRunEventSink;
};

export class AgentLoop {
  private readonly model: ModelClient;
  private readonly modelAudit?: AgentLoopOptions["modelAudit"];
  private readonly tools: Map<string, RegisteredTool>;
  private readonly systemPrompt: string;
  private readonly runBudget: AgentRunBudget;
  private readonly store?: AgentStore;
  private readonly actor?: ActorRef;
  private readonly contextAttachments: AgentContextAttachment[];
  private readonly contextCompaction?: Omit<ModelRequestCompactionOptions, "messages" | "tools">;
  private readonly selectedSkillIds: string[];
  private readonly targetMode: ExecutionTargetMode;
  private readonly planDirectory?: string;
  private readonly sessionScope: Pick<Session, "orgId" | "projectId" | "roomId">;
  private readonly onSessionActivated?: (session: Session) => void;
  private readonly onProgress?: AgentRunEventSink;
  private readonly runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  constructor(options: AgentLoopOptions) {
    this.model = options.model;
    this.modelAudit = options.modelAudit;
    this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.systemPrompt = options.systemPrompt;
    this.targetMode = options.targetMode ?? "build";
    const modePolicy = agentModePolicy(this.targetMode);
    this.runBudget = createRunBudget({
      ...modePolicy.defaultBudget,
      ...options.runBudget,
      maxSteps: options.maxSteps ?? options.runBudget?.maxSteps ?? modePolicy.defaultBudget.maxSteps,
    });
    this.store = options.store;
    this.actor = options.actor;
    this.contextAttachments = options.contextAttachments ?? [];
    this.contextCompaction = options.contextCompaction;
    this.selectedSkillIds = options.selectedSkillIds ?? [];
    this.sessionScope = options.sessionScope ?? {};
    this.planDirectory = options.planDirectory;
    this.onSessionActivated = options.onSessionActivated;
    this.onProgress = options.onProgress;
  }

  async run(userTask: string): Promise<string> {
    if (this.targetMode === "plan") {
      return (await this.runPlan(userTask)).content;
    }
    const context = new ContextManager(this.systemPrompt, this.enrichUserTask(userTask));
    const session = await this.createSession(userTask);
    if (session) {
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "system", content: this.systemPrompt } });
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "user", content: this.enrichUserTask(userTask) } });
      await this.recordSelectedSkills(session);
    }

    return this.runContext(context, session);
  }

  async runWithSession(userTask: string): Promise<{ session: Session | undefined; finalAnswer: string; planPath?: string }> {
    if (this.targetMode === "plan") {
      const session = await this.createSession(userTask);
      const plan = await this.runPlan(userTask, session);
      return {
        session,
        finalAnswer: plan.content,
        planPath: plan.planPath,
      };
    }
    const context = new ContextManager(this.systemPrompt, this.enrichUserTask(userTask));
    const session = await this.createSession(userTask);
    if (session) {
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "system", content: this.systemPrompt } });
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "user", content: this.enrichUserTask(userTask) } });
      await this.recordSelectedSkills(session);
    }
    return {
      session,
      finalAnswer: await this.runContext(context, session),
    };
  }

  async resume(sessionId: string): Promise<string> {
    if (!this.store) {
      throw new Error("Cannot resume without an AgentStore.");
    }
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const messages = await this.store.getMessages(sessionId);
    if (messages.length === 0) {
      throw new Error(`Session has no messages: ${sessionId}`);
    }
    const actor = this.actor ?? session.createdBy;
    const tasks = new TaskOperationsService(this.store);
    const resumed = await tasks.markResumed({ sessionId, actor, reason: "CLI resume" });
    const compaction = this.targetMode === "goal"
      ? compactMessagesForGoal({
          messages,
          keepLast: GOAL_CONTEXT_COMPACTION_KEEP_LAST,
          maxChars: GOAL_CONTEXT_COMPACTION_MAX_CHARS,
        })
      : { compacted: false as const, messages };
    if (compaction.compacted && compaction.summary) {
      await this.store.addSessionSummary({
        id: makeId<"SessionSummaryId">("sum"),
        sessionId,
        summary: compaction.summary,
        createdAt: new Date().toISOString(),
      });
    }
    const continuation = compaction.compacted
      ? `${formatResumeContinuationPrompt(session, "CLI resume")}\n\n${CONTEXT_COMPACTION_CONTINUATION_PROMPT}`
      : formatResumeContinuationPrompt(session, "CLI resume");
    const context = ContextManager.fromMessages(compaction.messages);
    context.addUser(continuation);
    await this.store.appendMessage({
      sessionId,
      message: { role: "user", content: continuation },
    });
    return this.runContext(context, resumed);
  }

  private async runPlan(userTask: string, existingSession?: Session): Promise<{ content: string; planPath?: string }> {
    const session = existingSession ?? (await this.createSession(userTask));
    const planPath = this.planDirectory ? planFilePath(this.planDirectory, userTask, session?.id) : undefined;
    const planTask = this.enrichUserTask(formatPlanTask(userTask, planPath));
    const planPrompt = `${this.systemPrompt}\n\n${formatPlanModePrompt(planPath)}`;
    const context = new ContextManager(planPrompt, planTask);
    if (session) {
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "system", content: planPrompt } });
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "user", content: planTask } });
      await this.recordSelectedSkills(session);
      this.onSessionActivated?.(session);
    }

    let content = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.completeModel({
        messages: context.snapshot(),
        tools: [],
      }, session);
      content =
        response.type === "message"
          ? response.content
          : response.content?.trim() || "Plan mode produced tool calls, but tools are disabled in plan mode. Please revise the plan without executing tools.";
      if (content.trim()) {
        break;
      }
      await this.requestVisibleFinalAnswer(context, session);
    }

    if (session) {
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "assistant", content } });
      await this.store?.addSessionSummary({
        id: `sum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: session.id,
        summary: content.length > 1000 ? `${content.slice(0, 1000)}\n[truncated]` : content,
        createdAt: new Date().toISOString(),
      });
      await this.store?.updateSessionStatus(session.id, "completed");
    }
    if (planPath) {
      await writePlanDocument(planPath, userTask, content, session?.id);
    }
    return { content, planPath };
  }

  private async runContext(context: ContextManager, session?: Session): Promise<string> {
    if (session) {
      this.onSessionActivated?.(session);
    }
    const budget = new RunBudgetController(this.runBudget, this.targetMode, session?.id);
    const goalService = this.targetMode === "goal" && this.store && session ? new GoalService(this.store) : undefined;
    let goal = goalService && session ? await goalService.startForSession(session) : undefined;
    if (goal) {
      await this.emitGoalUpdated(goal, "Goal started.", budget, session);
    }
    const doomLoop = new DoomLoopDetector(this.runBudget.maxRepeatedToolCalls ?? 3);
    while (true) {
      const budgetStop = budget.beforeStep();
      if (budgetStop) {
        return this.stopRun(budgetStop, budget, session, goalService, goal);
      }
      budget.recordStepStarted();
      const stepNumber = budget.usage.steps;
      const toolDefinitions = [...this.tools.values()].map(({ handler: _handler, ...definition }) => definition);
      const compactionOptions = this.contextCompaction ?? {};
      await this.compactContextForModelRequest(context, toolDefinitions, compactionOptions, session);
      let request = {
        messages: context.snapshot(),
        tools: toolDefinitions,
      };
      await this.emitProgress({
        type: "step_started",
        step: stepNumber,
        sessionId: session?.id,
      });
      const modelStartedAt = Date.now();
      let response: ModelResponse;
      let recoveredFromOverflow = false;
      try {
        while (true) {
          try {
            budget.recordModelCall();
            response = await this.completeModel(request, session, stepNumber);
            break;
          } catch (error) {
            if (
              !recoveredFromOverflow &&
              isModelContextOverflowError(error) &&
              (await this.compactContextForModelRequest(context, toolDefinitions, compactionOptions, session, true))
            ) {
              recoveredFromOverflow = true;
              request = {
                messages: context.snapshot(),
                tools: toolDefinitions,
              };
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        await this.emitProgress({
          type: "model_failed",
          step: stepNumber,
          durationMs: Date.now() - modelStartedAt,
          sessionId: session?.id,
        });
        const stop = this.runtimeStopFromModelError(error, session);
        if (stop) {
          return this.stopRun(stop, budget, session, goalService, goal);
        }
        throw error;
      }
      await this.emitProgress({
        type: "model_finished",
        step: stepNumber,
        sessionId: session?.id,
        responseType: response.type,
        toolCallCount: response.type === "tool_calls" ? response.toolCalls.length : 0,
        durationMs: Date.now() - modelStartedAt,
        usage: response.metadata?.usage,
      });
      if (stepNumber % 10 === 0) {
        await this.emitRunBudgetCheckpoint(budget, session);
      }

      if (response.type === "tool_calls") {
        const doom = doomLoop.record(response.toolCalls);
        if (doom) {
          const reason = `Stopped repeated identical tool call: ${doom.toolName} repeated ${doom.count} time(s).`;
          const stop = budget.stop("doom_loop", reason);
          await this.emitProgress({
            type: "guardrail_tripped",
            sessionId: session?.id,
            guardrail: "doom_loop",
            reason,
            toolName: doom.toolName,
            count: doom.count,
            resumeCommand: stop.resumeCommand,
          });
          return this.stopRun(stop, budget, session, goalService, goal);
        }
      }

      if (response.type === "message") {
        if (!response.content.trim()) {
          await this.requestVisibleFinalAnswer(context, session, stepNumber);
          continue;
        }
        await this.emitProgress({
          type: "assistant_text",
          step: stepNumber,
          sessionId: session?.id,
          text: response.content,
          final: true,
        });
        if (session) {
          await this.store?.appendMessage({ sessionId: session.id, message: { role: "assistant", content: response.content } });
          await this.store?.addSessionSummary({
            id: `sum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sessionId: session.id,
            summary: response.content.length > 1000 ? `${response.content.slice(0, 1000)}\n[truncated]` : response.content,
            createdAt: new Date().toISOString(),
          });
          if (goalService && goal) {
            goal = await goalService.updateUsage(goal.id, {
              modelCalls: budget.usage.modelCalls,
              tokenUsed: response.metadata?.usage?.totalTokens ?? goal.tokenUsed,
            });
            goal = await goalService.tryMarkComplete(goal.id, {
              verified: true,
              summary: summarizeGoalUpdate(response.content),
            });
            await this.emitGoalUpdated(goal, summarizeGoalUpdate(response.content), budget, session);
          }
          await this.store?.updateSessionStatus(session.id, "completed");
        }
        return response.content;
      }

      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      };
      context.addAssistant(assistantMessage.content, response.toolCalls);
      if (session) {
        await this.store?.appendMessage({ sessionId: session.id, message: assistantMessage });
      }
      if (assistantMessage.content.trim()) {
        await this.emitProgress({
          type: "assistant_note",
          step: stepNumber,
          sessionId: session?.id,
          text: assistantMessage.content,
        });
      }

      for (const toolCall of response.toolCalls) {
        const display = summarizeToolInput(toolCall.name, toolCall.input);
        await this.emitProgress({
          type: "tool_started",
          step: stepNumber,
          sessionId: session?.id,
          toolName: toolCall.name,
          callId: toolCall.id,
          title: display.title,
          detailsHidden: display.detailsHidden ?? true,
          paths: display.paths,
        });
        const result = await this.runTool(toolCall);
        const resultDisplay = result.display ?? display;
        await this.emitProgress({
          type: "tool_finished",
          step: stepNumber,
          sessionId: session?.id,
          toolName: toolCall.name,
          callId: toolCall.id,
          title: resultDisplay.title,
          status: result.ok ? "ok" : "failed",
          detailsHidden: resultDisplay.detailsHidden ?? true,
          errorCode: result.error?.code,
          paths: resultDisplay.paths,
          exitCode: resultDisplay.exitCode,
          timedOut: resultDisplay.timedOut,
          durationMs: resultDisplay.durationMs,
          stdoutBytes: resultDisplay.stdoutBytes,
          stderrBytes: resultDisplay.stderrBytes,
        });
        const approvalId = approvalIdFromResult(result);
        const isWaitingForApproval = result.error?.code === "approval_required";
        if (!isWaitingForApproval) {
          context.addToolResult(result);
        }
        if (session && this.store) {
          await this.store.recordToolCall({ sessionId: session.id, result });
          if (isWaitingForApproval) {
            const tasks = new TaskOperationsService(this.store);
            await tasks.pause({
              sessionId: session.id,
              actor: this.actor ?? session.createdBy,
              reason: approvalId ? `Waiting for approval ${approvalId}` : "Waiting for tool approval",
            });
            return approvalId
              ? `Session ${session.id} paused waiting for approval ${approvalId}. Run: agent approve ${approvalId} --auto-replay --auto-resume, or use --queue-resume <worker-id> for worker continuation.`
              : `Session ${session.id} paused waiting for tool approval.`;
          }
          await this.store.appendMessage({
            sessionId: session.id,
            message: {
              role: "tool",
              content: JSON.stringify(result),
              toolResult: result,
            },
          });
          if (goalService && goal && result.ok) {
            goal = await goalService.recordCheckpoint(goal.id, {
              kind: "progress",
              sessionId: session.id,
              summary: `${toolCall.name} completed.`,
              metadata: { step: stepNumber, toolName: toolCall.name },
            });
            goal = await goalService.updateUsage(goal.id, { modelCalls: budget.usage.modelCalls });
            await this.emitGoalUpdated(goal, `${toolCall.name} completed.`, budget, session);
          }
        }
      }
    }
  }

  private async stopRun(
    stop: ReturnType<RunBudgetController["stop"]>,
    budget: RunBudgetController,
    session?: Session,
    goalService?: GoalService,
    goal?: GoalRun,
  ): Promise<string> {
    if (session) {
      await this.store?.updateSessionStatus(session.id, "failed");
    }
    if (session && goalService && goal) {
      const summary = summarizeGoalUpdate(stop.reason);
      goal = await goalService.recordCheckpoint(goal.id, {
        kind: "budget",
        sessionId: session.id,
        summary,
        metadata: {
          stopKind: stop.kind,
          steps: budget.usage.steps,
          modelCalls: budget.usage.modelCalls,
        },
      });
      goal = await goalService.updateUsage(goal.id, { modelCalls: budget.usage.modelCalls });
      await this.emitGoalUpdated(goal, summary, budget, session);
    }
    await this.emitRunBudgetCheckpoint(budget, session);
    if (stop.kind === "step_budget" && stop.maxSteps !== undefined) {
      await this.emitProgress({ type: "step_limit_reached", maxSteps: stop.maxSteps, sessionId: session?.id });
    }
    await this.emitProgress({
      type: "runtime_stopped",
      sessionId: session?.id,
      stopKind: stop.kind,
      targetMode: stop.targetMode,
      maxSteps: stop.maxSteps,
      reason: stop.reason,
      resumeCommand: stop.resumeCommand,
    });
    return formatRuntimeStopAnswer(stop);
  }

  private async emitGoalUpdated(goal: GoalRun, summary: string, budget: RunBudgetController, session?: Session): Promise<void> {
    await this.emitProgress({
      type: "goal_updated",
      sessionId: session?.id ?? goal.sessionId,
      goalId: goal.id,
      status: goal.status,
      objective: goal.objective,
      summary,
      repeatedBlockers: goal.repeatedBlockers,
      tokenUsed: goal.tokenUsed,
      modelCalls: goal.modelCalls || budget.usage.modelCalls,
    });
  }

  private async emitRunBudgetCheckpoint(budget: RunBudgetController, session?: Session): Promise<void> {
    const checkpoint = budget.checkpoint();
    await this.emitProgress({
      type: "run_budget_checkpoint",
      sessionId: session?.id,
      targetMode: this.targetMode,
      steps: checkpoint.steps,
      modelCalls: checkpoint.modelCalls,
      elapsedMs: checkpoint.elapsedMs,
      maxSteps: budget.budget.maxSteps,
      maxModelCalls: budget.budget.maxModelCalls,
      maxDurationMs: budget.budget.maxDurationMs,
    });
  }

  private runtimeStopFromModelError(error: unknown, session?: Session) {
    if (!(error instanceof ModelBudgetExceededError)) {
      return undefined;
    }
    return modelBudgetRuntimeStop({
      sessionId: session?.id,
      targetMode: this.targetMode,
      kind: error.reason === "max_calls" ? "model_call_budget" : "model_failure_budget",
    });
  }

  private async requestVisibleFinalAnswer(context: ContextManager, session?: Session, step?: number): Promise<void> {
    context.addUser(EMPTY_FINAL_RESPONSE_REPAIR_PROMPT);
    if (session) {
      await this.store?.appendMessage({ sessionId: session.id, message: { role: "user", content: EMPTY_FINAL_RESPONSE_REPAIR_PROMPT } });
    }
    const note = {
      type: "assistant_note" as const,
      sessionId: session?.id,
      text: "Model returned an empty visible answer; requesting a concise final answer.",
    };
    await this.emitProgress({ ...note, step: step ?? 0 });
  }

  private async createSession(userTask: string): Promise<Session | undefined> {
    if (!this.store || !this.actor) {
      return undefined;
    }

    const session = await this.store.createSession({
      orgId: this.sessionScope.orgId,
      projectId: this.sessionScope.projectId,
      roomId: this.sessionScope.roomId,
      objective: userTask,
      targetMode: this.targetMode,
      status: "running",
      risk: "medium",
      createdBy: this.actor,
    });
    this.onSessionActivated?.(session);
    await this.emitProgress({ type: "session_started", sessionId: session.id, objective: userTask, targetMode: this.targetMode });
    return session;
  }

  private async emitProgress(event: AgentRunEventInput): Promise<void> {
    const fullEvent = withEventDefaults({ runId: this.runId, ...event } as AgentRunEvent);
    await this.onProgress?.(fullEvent);
    await this.recordAgentRunEvent(fullEvent);
  }

  private async recordAgentRunEvent(event: AgentRunEvent): Promise<void> {
    if (!this.store || !event.sessionId || event.type === "assistant_text" || event.type === "assistant_note") {
      return;
    }
    const actor = this.actor ?? { type: "system" as const, id: "agent-loop" };
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "agent.event",
      actor,
      orgId: this.sessionScope.orgId,
      projectId: this.sessionScope.projectId,
      roomId: this.sessionScope.roomId,
      sessionId: event.sessionId,
      summary: `agent.event.${event.type}`,
      metadata: safeAgentRunEventMetadata(event),
      artifactRefs: [],
      createdAt: event.createdAt ?? new Date().toISOString(),
    });
  }

  private enrichUserTask(userTask: string): string {
    const modeInstruction = this.targetMode === "goal" ? GOAL_MODE_TASK_PREFIX : this.targetMode === "build" ? BUILD_MODE_TASK_PREFIX : "";
    const baseTask = modeInstruction ? `${modeInstruction}\n\n${userTask}` : userTask;
    if (this.contextAttachments.length === 0) {
      return baseTask;
    }

    const attachments = this.contextAttachments.map((attachment) => {
      return `## ${attachment.label}\n${attachment.content}`;
    });

    return `${baseTask}\n\n# Additional Context\n\n${attachments.join("\n\n")}`;
  }

  private async recordSelectedSkills(session: Session): Promise<void> {
    for (const skillId of this.selectedSkillIds) {
      await this.store?.recordSkillUsage({
        id: `skilluse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        skillId,
        sessionId: session.id,
        actorId: this.actor?.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  private async runTool(toolCall: ToolCall) {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        callId: toolCall.id,
        ok: false,
        error: {
          code: "tool_not_found",
          message: `No tool registered named ${toolCall.name}`,
        },
      };
    }

    const result = await tool.handler({
      ...toolCall.input,
      __toolCallId: toolCall.id,
    });
    return {
      ...result,
      callId: toolCall.id,
    };
  }

  private contextCompactionSummarizer(session?: Session): ModelRequestCompactionOptions["summarize"] {
    if (this.contextCompaction?.summaryMode !== "model" && this.contextCompaction?.summaryMode !== "auto") {
      return undefined;
    }
    return async ({ prompt }) => {
      const response = await this.completeModel({
        messages: [{ role: "user", content: prompt }],
        tools: [],
      }, session);
      return response.type === "message" ? response.content : response.content;
    };
  }

  private async compactContextForModelRequest(
    context: ContextManager,
    toolDefinitions: ToolDefinition[],
    compactionOptions: Omit<ModelRequestCompactionOptions, "messages" | "tools">,
    session?: Session,
    force = false,
  ): Promise<boolean> {
    const previousCheckpoint = await this.latestStoredModelRequestCompactionCheckpoint(session);
    const compaction = await compactMessagesForModelRequestWithSummary({
      messages: context.snapshot(),
      tools: toolDefinitions,
      ...compactionOptions,
      previousCheckpoint: compactionOptions.previousCheckpoint ?? previousCheckpoint,
      force,
      summarize: compactionOptions.summarize ?? this.contextCompactionSummarizer(session),
    });
    if (!compaction.compacted) {
      return false;
    }
    context.replace(compaction.messages);
    if (session && compaction.summary) {
      await this.store?.addSessionSummary({
        id: makeId<"SessionSummaryId">("sum"),
        sessionId: session.id,
        summary: formatStoredModelRequestCompactionSummary({
          summary: compaction.summary,
          recent: compaction.recent,
        }),
        createdAt: new Date().toISOString(),
      });
    }
    return true;
  }

  private async latestStoredModelRequestCompactionCheckpoint(
    session?: Session,
  ): Promise<ModelRequestCompactionOptions["previousCheckpoint"]> {
    if (!this.store || !session) {
      return undefined;
    }
    const summaries = await this.store.getSessionSummaries(session.id);
    for (const summary of summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
      const checkpoint = parseStoredModelRequestCompactionSummary(summary.summary);
      if (checkpoint) {
        return checkpoint;
      }
    }
    return undefined;
  }

  private async completeModel(request: { messages: AgentMessage[]; tools: ToolDefinition[] }, session?: Session, progressStep?: number): Promise<ModelResponse> {
    const startedAt = Date.now();
    try {
      const response = this.model.streamComplete
        ? await this.completeStreamingModel(request, session, progressStep)
        : await this.model.complete(request);
      await this.auditModelCall({
        session,
        request,
        ok: true,
        durationMs: Date.now() - startedAt,
        response,
      });
      return response;
    } catch (error) {
      await this.auditModelCall({
        session,
        request,
        ok: false,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  private async completeStreamingModel(request: { messages: AgentMessage[]; tools: ToolDefinition[] }, session?: Session, progressStep?: number): Promise<ModelResponse> {
    let finalResponse: ModelResponse | undefined;
    let bufferedText = "";
    let reasoningStartedAt: number | undefined;
    let reasoningDeltaCount = 0;
    for await (const event of this.model.streamComplete?.(request) ?? []) {
      if (event.type === "text_delta") {
        bufferedText += event.text;
        if (reasoningStartedAt !== undefined && progressStep !== undefined) {
          await this.emitProgress({
            type: "reasoning_finished",
            step: progressStep,
            sessionId: session?.id,
            publicSummary: "Thinking",
            deltaCount: reasoningDeltaCount,
            durationMs: Date.now() - reasoningStartedAt,
          });
          reasoningStartedAt = undefined;
          reasoningDeltaCount = 0;
        }
        if (progressStep !== undefined && event.text) {
          await this.emitProgress({
            type: "assistant_text",
            step: progressStep,
            sessionId: session?.id,
            text: event.text,
          });
        }
        continue;
      }
      if (event.type === "reasoning_delta") {
        if (progressStep !== undefined) {
          if (reasoningStartedAt === undefined) {
            reasoningStartedAt = Date.now();
            await this.emitProgress({
              type: "reasoning_started",
              step: progressStep,
              sessionId: session?.id,
              publicSummary: "Thinking",
            });
          }
          reasoningDeltaCount += 1;
          await this.emitProgress({
            type: "reasoning_delta",
            step: progressStep,
            sessionId: session?.id,
            publicSummary: "Thinking",
            deltaCount: reasoningDeltaCount,
            elapsedMs: Date.now() - reasoningStartedAt,
          });
        }
        continue;
      }
      if (event.type === "tool_call_delta") {
        continue;
      }
      finalResponse = event;
    }
    if (reasoningStartedAt !== undefined && progressStep !== undefined) {
      await this.emitProgress({
        type: "reasoning_finished",
        step: progressStep,
        sessionId: session?.id,
        publicSummary: "Thinking",
        deltaCount: reasoningDeltaCount,
        durationMs: Date.now() - reasoningStartedAt,
      });
    }
    return finalResponse ?? { type: "message", content: bufferedText };
  }

  private async auditModelCall(input: {
    session?: Session;
    request: { messages: AgentMessage[]; tools: ToolDefinition[] };
    ok: boolean;
    durationMs: number;
    response?: ModelResponse;
    error?: unknown;
  }): Promise<void> {
    if (!this.store) {
      return;
    }
    const actor = this.actor ?? input.session?.createdBy ?? { type: "system" as const, id: "agent-loop" };
    const messageCharCount = input.request.messages.reduce((total, message) => total + message.content.length, 0);
    await this.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "model.called",
      actor,
      orgId: input.session?.orgId ?? this.sessionScope.orgId,
      projectId: input.session?.projectId ?? this.sessionScope.projectId,
      roomId: input.session?.roomId ?? this.sessionScope.roomId,
      sessionId: input.session?.id,
      summary: input.ok ? "Model call completed" : "Model call failed",
      metadata: {
        ok: input.ok,
        provider: this.modelAudit?.provider ?? "unknown",
        model: this.modelAudit?.model ?? "unknown",
        fallbackProviders: this.modelAudit?.fallbackProviders ?? [],
        targetMode: this.targetMode,
        durationMs: input.durationMs,
        messageCount: input.request.messages.length,
        messageCharCount,
        toolCount: input.request.tools.length,
        responseType: input.response?.type,
        toolCallCount: input.response?.type === "tool_calls" ? input.response.toolCalls.length : 0,
        providerRequestId: input.response?.metadata?.providerRequestId,
        providerResponseId: input.response?.metadata?.providerResponseId,
        providerResponseModel: input.response?.metadata?.providerModel,
        usage: input.response?.metadata?.usage,
        error: input.error ? safeModelError(input.error) : undefined,
      },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
  }
}

function approvalIdFromResult(result: { data?: unknown }): string | undefined {
  return typeof result.data === "object" && result.data !== null && "approvalId" in result.data ? String(result.data.approvalId) : undefined;
}

function safeAgentRunEventMetadata(event: AgentRunEvent): Record<string, unknown> {
  const base: Record<string, unknown> = {
    eventType: event.type,
    runId: event.runId,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
  };
  switch (event.type) {
    case "session_started":
      return {
        ...base,
        objective: redactAgentEventText(event.objective),
        targetMode: event.targetMode,
      };
    case "step_started":
      return {
        ...base,
        step: event.step,
        provider: event.provider,
        model: event.model,
      };
    case "model_finished":
      return {
        ...base,
        step: event.step,
        responseType: event.responseType,
        toolCallCount: event.toolCallCount,
        durationMs: event.durationMs,
        usage: event.usage,
      };
    case "model_failed":
      return {
        ...base,
        step: event.step,
        durationMs: event.durationMs,
      };
    case "reasoning_started":
      return {
        ...base,
        step: event.step,
        publicSummary: redactAgentEventText(event.publicSummary),
      };
    case "reasoning_delta":
      return {
        ...base,
        step: event.step,
        publicSummary: redactAgentEventText(event.publicSummary),
        deltaCount: event.deltaCount,
        elapsedMs: event.elapsedMs,
      };
    case "reasoning_finished":
      return {
        ...base,
        step: event.step,
        publicSummary: redactAgentEventText(event.publicSummary),
        deltaCount: event.deltaCount,
        durationMs: event.durationMs,
      };
    case "goal_updated":
      return {
        ...base,
        goalId: event.goalId,
        status: event.status,
        objective: redactAgentEventText(event.objective),
        summary: redactAgentEventText(event.summary),
        repeatedBlockers: event.repeatedBlockers,
        tokenUsed: event.tokenUsed,
        modelCalls: event.modelCalls,
      };
    case "tool_started":
      return {
        ...base,
        step: event.step,
        callId: event.callId,
        toolName: event.toolName,
        tool: event.toolName,
        title: redactAgentEventText(event.title),
        detailsHidden: event.detailsHidden,
        paths: event.paths?.map(redactAgentEventText),
      };
    case "tool_finished":
      return {
        ...base,
        step: event.step,
        callId: event.callId,
        toolName: event.toolName,
        tool: event.toolName,
        title: redactAgentEventText(event.title),
        status: event.status,
        ok: event.status === "ok",
        detailsHidden: event.detailsHidden,
        errorCode: event.errorCode,
        paths: event.paths?.map(redactAgentEventText),
        exitCode: event.exitCode,
        timedOut: event.timedOut,
        durationMs: event.durationMs,
        stdoutBytes: event.stdoutBytes,
        stderrBytes: event.stderrBytes,
      };
    case "file_changed":
      return {
        ...base,
        step: event.step,
        path: redactAgentEventText(event.path),
        change: event.change,
      };
    case "run_budget_checkpoint":
      return {
        ...base,
        targetMode: event.targetMode,
        steps: event.steps,
        modelCalls: event.modelCalls,
        elapsedMs: event.elapsedMs,
        maxSteps: event.maxSteps,
        maxModelCalls: event.maxModelCalls,
        maxDurationMs: event.maxDurationMs,
      };
    case "guardrail_tripped":
      return {
        ...base,
        guardrail: event.guardrail,
        reason: redactAgentEventText(event.reason),
        toolName: event.toolName,
        count: event.count,
        resumeCommand: event.resumeCommand,
      };
    case "step_limit_reached":
      return {
        ...base,
        maxSteps: event.maxSteps,
      };
    case "runtime_stopped":
      return {
        ...base,
        stopKind: event.stopKind,
        targetMode: event.targetMode,
        maxSteps: event.maxSteps,
        reason: redactAgentEventText(event.reason),
        resumeCommand: event.resumeCommand,
      };
    case "run_failed":
      return {
        ...base,
        message: redactAgentEventText(event.message),
      };
    case "assistant_text":
    case "assistant_note":
      return base;
  }
}

function safeModelError(error: unknown): Record<string, unknown> {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  return {
    name: error instanceof Error ? error.name : typeof error,
    status: typeof record.status === "number" ? record.status : undefined,
    providerKind: typeof record.providerKind === "string" ? record.providerKind : undefined,
  };
}

function isModelContextOverflowError(error: unknown): boolean {
  const fields = errorFields(error).join(" ").toLowerCase();
  return (
    fields.includes("context_length_exceeded") ||
    fields.includes("context window") ||
    fields.includes("maximum context") ||
    fields.includes("max context") ||
    fields.includes("prompt is too long") ||
    fields.includes("input is too long") ||
    fields.includes("too many tokens") ||
    /tokens?\s+(exceed|exceeded|exceeds)/.test(fields) ||
    /(exceed|exceeded|exceeds)\s+.*tokens?/.test(fields)
  );
}

function errorFields(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [String(error)];
  }
  const record = error as Error & {
    code?: unknown;
    type?: unknown;
    status?: unknown;
    cause?: unknown;
  };
  const fields = [
    error.name,
    error.message,
    typeof record.code === "string" ? record.code : undefined,
    typeof record.type === "string" ? record.type : undefined,
    typeof record.status === "number" ? String(record.status) : undefined,
  ];
  if (record.cause !== undefined && record.cause !== error) {
    fields.push(...errorFields(record.cause));
  }
  return fields.filter((field): field is string => Boolean(field));
}

function summarizeGoalUpdate(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Goal progress updated.";
  }
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

function formatPlanModePrompt(planPath: string | undefined): string {
  const planFileLine = planPath
    ? `Plan file: ${planPath}\nThis is the only file that may be written. Do not modify, create, delete, or rename any other file.`
    : "Do not modify project files. If a plan file path is provided by the runner, that plan file is the only writable file.";
  return `Target mode: plan.
Do not execute tools. ${planFileLine}
Produce a concrete implementation plan, call out risks and verification steps, and stop.`;
}

const EMPTY_FINAL_RESPONSE_REPAIR_PROMPT =
  "Your previous response had no visible final answer. Return a concise visible final answer now. Do not call tools.";

const RESUME_CONTINUATION_PROMPT = `Continue this existing Soloclaw session.

Previous objective:
{objective}

Continuation reason:
{reason}

Continue from the existing transcript. Do not restart project discovery unless needed. Verify the remaining task before claiming completion.`;

const CONTEXT_COMPACTION_CONTINUATION_PROMPT =
  "Continue after context compaction. Do not restart project discovery. Use the compacted context and recent transcript to finish the existing objective.";

const GOAL_CONTEXT_COMPACTION_KEEP_LAST = 30;
const GOAL_CONTEXT_COMPACTION_MAX_CHARS = 8000;

const BUILD_MODE_TASK_PREFIX = `Target mode: build.
Execute the user's current request using available tools when needed. Keep the scope tied to the current prompt.
Use file tools such as create_file, replace_range, and apply_patch for workspace file changes; reserve run_command for verification or commands that cannot be expressed with file tools.
When you verify work with a command, choose a command that must exit 0 when the intended condition is satisfied; for absence checks, wrap the check so expected absence exits 0.`;

const GOAL_MODE_TASK_PREFIX = `Target mode: goal.
Work toward the stated objective persistently. First form a concise plan, then execute it step by step with available tools. Update the plan as evidence changes, verify progress before claiming success, and continue until the objective is genuinely completed, blocked by required input, or stopped by policy.
Use file tools such as create_file, replace_range, and apply_patch for workspace file changes; reserve run_command for verification or commands that cannot be expressed with file tools. Use .agent/tmp for temporary evidence files when the task needs local scratch output.
When you verify work with a command, choose a command that must exit 0 when the intended condition is satisfied; for absence checks, wrap the check so expected absence exits 0.`;

function formatPlanTask(userTask: string, planPath: string | undefined): string {
  const planLine = planPath ? `Write the final plan document to the only allowed file: ${planPath}\n` : "";
  return `Create an implementation plan for this objective. Do not execute tools or modify project files.
${planLine}
Objective:
${userTask}`;
}

function planFilePath(planDirectory: string, userTask: string, sessionId: string | undefined): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = slugifyPlanTitle(userTask) || sessionId || "plan";
  const sessionTail = sessionId ? `-${sessionId}` : "";
  return path.join(planDirectory, `${stamp}-${slug}${sessionTail}.md`);
}

function slugifyPlanTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

async function writePlanDocument(planPath: string, userTask: string, content: string, sessionId: string | undefined): Promise<void> {
  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(planPath, formatPlanDocument(userTask, content, sessionId), "utf8");
}

function formatPlanDocument(userTask: string, content: string, sessionId: string | undefined): string {
  const title = summarizePlanTitle(userTask);
  const rows = [
    `# Plan: ${title}`,
    "",
    `- Objective: ${userTask}`,
    sessionId ? `- Session: ${sessionId}` : undefined,
    `- Generated: ${new Date().toISOString()}`,
    "",
    content.trim(),
    "",
  ].filter((row): row is string => row !== undefined);
  return rows.join("\n");
}

function summarizePlanTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Untitled";
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function formatResumeContinuationPrompt(session: Session, reason: string): string {
  return RESUME_CONTINUATION_PROMPT
    .replace("{objective}", session.objective)
    .replace("{reason}", reason);
}
