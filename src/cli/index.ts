#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type {
  ActorRef,
  AgentHeartbeatStatus,
  ApprovalRequest,
  ArtifactKind,
  AuditEvent,
  AuditExportBundle,
  CapabilityGrant,
  ExecutionMode,
  FileChange,
  KnowledgeSourceKind,
  KnowledgeTrustLevel,
  McpServerRegistration,
  MemoryScope,
  PolicyAction,
  RetentionPolicy,
  RoomMemberStatus,
  RoomRoutingDiagnostic,
  RoomRole,
  SpecificationPlanStatus,
  TaskAssignment,
  TaskAssignmentStatus,
  TaskRisk,
  WorkerHeartbeatEnvelope,
  WorkerRegistration,
  WorkerStatus,
} from "../domain/index.js";
import { ControlPlaneService } from "../control-plane/control-plane-service.js";
import { DEFAULT_ROOM_AGENT_RESPONSE_MODE, DEFAULT_ROOM_WIDE_MENTION_POLICY } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import { scanExecutionHygiene } from "../hygiene/execution-hygiene.js";
import type { OperatorItemKind, OperatorItemView, OperatorSeverity, OperatorStatus, OperatorViewModel } from "../operator/operator-view-models.js";
import { operatorSections, type OperatorDetailView } from "../operator/operator-detail.js";
import { collectOperatorRows, hasOperatorFilters, operatorItemMatches, type OperatorRowView } from "../operator/operator-rows.js";
import { LocalProviderProfileStore, type ModelProviderProfileView } from "../model/local-provider-profile-store.js";
import type { ModelProviderName } from "../model/model-client.js";
import { ModelUsageService } from "../model/model-usage-service.js";
import type { ModelUsageSummaryEntry } from "../model/model-usage-service.js";
import { McpConnectionPlanner } from "../mcp/mcp-connection-planner.js";
import type { McpConnectionPlan } from "../mcp/mcp-connection-planner.js";
import { McpExecutionService } from "../mcp/mcp-execution-service.js";
import type { McpExecutionResult } from "../mcp/mcp-execution-service.js";
import { McpHealthService } from "../mcp/mcp-health-service.js";
import type { McpHealthCheckResult } from "../mcp/mcp-health-service.js";
import { LocalMcpRegistry, parseMcpCapabilities } from "../mcp/local-mcp-registry.js";
import { LocalMcpRuntime } from "../mcp/local-mcp-runtime.js";
import { createLocalPlatform } from "../platform/local-platform.js";
import { RemoteRoomRunner } from "../remote/remote-room-runner.js";
import type { SchedulerRunResult, SchedulerTickResult } from "../scheduler/local-scheduler-service.js";
import type { PutSecretInput } from "../secrets/secret-store.js";
import type { KnowledgeEvalCase, KnowledgeEvalThresholds, KnowledgeSafetyMode } from "../knowledge/knowledge-service.js";
import { parseSpecificationClarificationStatus, parseSpecificationStatus, parseSpecificationTaskStatus } from "../specifications/specification-service.js";
import type { SpecificationEvidenceConclusion, SpecificationEvidenceProvider, SpecificationVerificationStatus } from "../specifications/specification-service.js";
import type { AgentStore, ListAuditEventsInput } from "../store/agent-store.js";
import type { ToolResult } from "../protocol/types.js";
import type { WorkerPollResult, WorkerRunOnceResult } from "../workers/local-worker-runner.js";
import { collectWorkspaceKeyFilePreviews, collectWorkspaceSnapshot, renderWorkspaceFilePreviews, renderWorkspaceSnapshot } from "../workspace/workspace-snapshot.js";
import { COMMAND_EXECUTION_PROFILE_NAMES, type CommandExecutionProfileName } from "../workspace/workspace-runtime.js";

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command) {
    await startTui(await resolveInitialWorkspace(process.cwd(), []), process.cwd());
    return;
  }

  if (command === "--workspace") {
    await startTui(await resolveInitialWorkspace(process.cwd(), [command, ...rest]), process.cwd());
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(rest);
    return;
  }

  if (command === "quickstart") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const args = stripWorkspaceOption(rest);
      const view = await buildSoloclawQuickstart(process.cwd(), workspace);
      if (args.includes("--json")) {
        console.log(JSON.stringify(view, null, 2));
      } else {
        printSoloclawQuickstart(view);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "init" || command === "setup") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const result = await initializeSoloclawWorkspace(process.cwd(), workspace, stripWorkspaceOption(rest));
      if (result.json) {
        console.log(JSON.stringify(result.view, null, 2));
      } else {
        printSoloclawInitView(result.view);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "tui") {
    await startTui(await resolveInitialWorkspace(process.cwd(), rest), process.cwd());
    return;
  }

  if (command === "doctor" || command === "check") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const args = stripWorkspaceOption(rest);
      const result = await verifyPhaseOneReadiness(workspace);
      if (args.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printPhaseOneReadiness(result);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "status") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const status = await buildSoloclawStatus(process.cwd(), workspace);
      if (rest.includes("--json")) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        printSoloclawStatus(status);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "smoke") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const answer = await runSoloclawSmoke(workspace);
      console.log(answer);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "providers") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const args = stripWorkspaceOption(rest);
      const profiles = new LocalProviderProfileStore(path.join(workspace, ".agent"));
      const parsed = parseModelProfileArgs(args);
      const listed = await profiles.list();
      const defaultProvider = await profiles.getDefaultProvider();
      if (parsed.options.json) {
        printModelProviderProfilesJson(listed, defaultProvider, profiles.filePath);
      } else {
        printModelProviderProfiles(listed, defaultProvider);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "workspace") {
    const subcommand = rest[0] ?? "list";
    const historyRoot = process.cwd();
    try {
      if (subcommand === "list" || subcommand === "ls" || subcommand === "recent") {
        const json = rest.slice(1).includes("--json");
        const history = await readWorkspaceHistory(historyRoot);
        if (json) {
          console.log(JSON.stringify({ configPath: workspaceHistoryPath(historyRoot), activeWorkspace: history.activeWorkspace, entries: history.entries }, null, 2));
        } else {
          printWorkspaceHistory(history);
        }
        return;
      }
      if (subcommand === "add") {
        const workspacePath = rest[1];
        if (!workspacePath) {
          console.error("Usage: soloclaw workspace add <path>");
          process.exitCode = 1;
          return;
        }
        const workspace = await recordWorkspaceHistoryEntry(historyRoot, path.resolve(historyRoot, workspacePath));
        console.log(`workspace=${workspace}`);
        console.log(`config=${workspaceHistoryPath(historyRoot)}`);
        return;
      }
      if (subcommand === "use" || subcommand === "select") {
        const selector = rest[1];
        if (!selector) {
          console.error("Usage: soloclaw workspace use <number|path>");
          process.exitCode = 1;
          return;
        }
        const workspace = await resolveWorkspaceSelector(historyRoot, selector, historyRoot);
        await recordWorkspaceHistoryEntry(historyRoot, workspace);
        console.log(`workspace=${workspace}`);
        console.log(`active=${workspace}`);
        console.log(`config=${workspaceHistoryPath(historyRoot)}`);
        console.log(`next=soloclaw tui --workspace "${workspace}"`);
        return;
      }
      console.error(`Unknown workspace command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "model") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const args = stripWorkspaceOption(rest);
      const subcommand = args[0] ?? "list";
      const profiles = new LocalProviderProfileStore(path.join(workspace, ".agent"));
      if (subcommand === "list" || subcommand === "ls") {
        const parsed = parseModelProfileArgs(args.slice(1));
        const listed = await profiles.list();
        const defaultProvider = await profiles.getDefaultProvider();
        if (parsed.options.json) {
          console.log(JSON.stringify({ profiles: listed, defaultProvider, configPath: profiles.filePath }, null, 2));
        } else {
          printModelProviderProfiles(listed, defaultProvider);
        }
        return;
      }
      if (subcommand === "providers" || subcommand === "presets") {
        const parsed = parseModelProfileArgs(args.slice(1));
        const listed = await profiles.list();
        const defaultProvider = await profiles.getDefaultProvider();
        if (parsed.options.json) {
          printModelProviderProfilesJson(listed, defaultProvider, profiles.filePath);
        } else {
          printModelProviderProfiles(listed, defaultProvider);
        }
        return;
      }
      if (subcommand === "env") {
        const result = await buildModelEnvView(workspace, args.slice(1));
        if (result.json) {
          console.log(JSON.stringify(result.view, null, 2));
        } else {
          printModelEnvView(result.view);
        }
        return;
      }
      if (subcommand === "check" || subcommand === "doctor") {
        const result = await buildModelCheckView(workspace, args.slice(1));
        if (result.json) {
          console.log(JSON.stringify(result.view, null, 2));
        } else {
          printModelCheckView(result.view);
        }
        if (!result.view.ready) {
          process.exitCode = 1;
        }
        return;
      }
      if (subcommand === "use" || subcommand === "default") {
        const providerName = args[1];
        if (!providerName) {
          console.error("Usage: soloclaw model use <provider>");
          process.exitCode = 1;
          return;
        }
        const selected = await selectDefaultModelProvider(profiles, providerName);
        console.log(`default=${selected.defaultProvider}`);
        console.log(`baseUrl=${selected.profile.defaultBaseUrl ?? "-"}`);
        console.log(`env=${selected.profile.apiKeyEnvNames.join(",") || "-"}`);
        console.log(`config=${profiles.filePath}`);
        return;
      }
      if (subcommand === "setup") {
        const parsed = parseModelProfileArgs(args.slice(1));
        const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
        let providerName = parsed.options.provider ?? (providerInput ? parseModelProviderName(providerInput) : undefined);
        if (!providerName && stdin.isTTY) {
          const promptedProvider = (await promptLine("Provider [openai]: ")) || "openai";
          parsed.options.providerInput = promptedProvider;
          providerName = parseModelProviderName(promptedProvider);
        }
        if (!providerName) {
          console.error("Usage: soloclaw model setup --provider <provider> [--base-url url] [--model model] [--api-key-env ENV] [--default]");
          process.exitCode = 1;
          return;
        }
        const current = (await profiles.list()).find((profile) => profile.name === providerName);
        if (!current) {
          throw new Error(`Unknown model provider: ${providerName}`);
        }
        const profile = await profiles.set({
          name: providerName,
          protocol: parsed.options.protocol ?? current.protocol,
          defaultBaseUrl: parsed.options.baseUrl ?? localModelAliasBaseUrl(parsed.options.providerInput ?? providerInput) ?? current.defaultBaseUrl,
          defaultModel: parsed.options.model ?? current.defaultModel,
          apiKeyEnvNames: resolveModelApiKeyEnvNames(parsed.options, parsed.options.providerInput ?? providerInput, current.apiKeyEnvNames),
        });
        if (parsed.options.setDefault || parsed.options.setDefault === undefined) {
          await profiles.setDefaultProvider(providerName);
        }
        const defaultProvider = await profiles.getDefaultProvider();
        console.log(`${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}\tdefault=${defaultProvider ?? "-"}`);
        console.log(`config=${profiles.filePath}`);
        return;
      }
      if (tryParseModelProviderName(subcommand)) {
        if (args.length > 1) {
          console.error("Usage: soloclaw model <provider>");
          process.exitCode = 1;
          return;
        }
        const selected = await selectDefaultModelProvider(profiles, subcommand);
        console.log(`default=${selected.defaultProvider}`);
        console.log(`baseUrl=${selected.profile.defaultBaseUrl ?? "-"}`);
        console.log(`env=${selected.profile.apiKeyEnvNames.join(",") || "-"}`);
        console.log(`config=${profiles.filePath}`);
        return;
      }
      console.error(`Unknown model command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "config") {
    try {
      const workspace = await resolveInitialWorkspace(process.cwd(), rest);
      const args = stripWorkspaceOption(rest);
      const subcommand = args[0] ?? "show";
      const profiles = new LocalProviderProfileStore(path.join(workspace, ".agent"));
      if (subcommand === "path") {
        console.log(profiles.filePath);
        return;
      }
      if (subcommand === "show") {
        const json = args.slice(1).includes("--json");
        const listed = await profiles.list();
        const defaultProvider = await profiles.getDefaultProvider();
        const view = { defaultProvider, configPath: profiles.filePath, profiles: listed };
        if (json) {
          console.log(JSON.stringify(view, null, 2));
        } else {
          console.log(`config=${profiles.filePath}`);
          console.log(`default=${defaultProvider ?? "-"}`);
          for (const profile of listed) {
            console.log(`${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}`);
          }
        }
        return;
      }
      console.error(`Unknown config command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "inspect") {
    const workspace = await resolveInitialWorkspace(process.cwd(), rest);
    const inspectArgs = stripWorkspaceOption(rest);
    const options = parseInspectArgs(inspectArgs);
    const snapshot = await collectWorkspaceSnapshot(workspace);
    const keyFilePreviews = options.includeKeyFiles ? await collectWorkspaceKeyFilePreviews(workspace, snapshot, {
      maxFiles: options.maxKeyFiles,
      maxLines: options.maxPreviewLines,
      maxChars: options.maxPreviewChars,
    }) : undefined;
    const previewText = keyFilePreviews ? renderWorkspaceFilePreviews(keyFilePreviews) : "";
    const text = [renderWorkspaceSnapshot(snapshot), previewText].filter(Boolean).join("\n\n");
    if (options.json) {
      console.log(JSON.stringify({ generatedAt: new Date().toISOString(), root: workspace, snapshot, keyFilePreviews, text }, null, 2));
    } else {
      console.log(text);
    }
    return;
  }

  if (command === "sessions") {
    const parsed = parseSessionListArgs(rest);
    const { store } = await createLocalPlatform(process.cwd());
    try {
      const list = await buildSessionList(store, parsed.options);
      if (parsed.options.json) {
        console.log(JSON.stringify(list, null, 2));
      } else {
        printSessionList(list);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "show-session") {
    const sessionId = rest[0];
    if (!sessionId) {
      console.error("Missing session id.");
      process.exitCode = 1;
      return;
    }
    const { store } = await createLocalPlatform(process.cwd());
    const session = await store.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      store.close();
      process.exitCode = 1;
      return;
    }
    const messages = await store.getMessages(sessionId);
    const toolResults = await store.getToolResults(sessionId);
    console.log(JSON.stringify({ session, messages, toolResults }, null, 2));
    store.close();
    return;
  }

  if (command === "resume") {
    const sessionId = rest[0];
    if (!sessionId) {
      console.error("Missing session id.");
      process.exitCode = 1;
      return;
    }
    let workspace: string;
    let cli: RunCliOptions;
    try {
      const resumeArgs = rest.slice(1);
      workspace = await resolveInitialWorkspace(process.cwd(), resumeArgs);
      cli = parseRunEvidenceArgs(stripWorkspaceOption(resumeArgs));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    const { agent, store } = await createLocalPlatform(workspace);
    try {
      const finalAnswer = await agent.resume(sessionId);
      const session = (await store.getSession(sessionId)) ?? undefined;
      let sessionResult: Awaited<ReturnType<typeof buildSessionResult>> | undefined;
      let verification: Awaited<ReturnType<typeof buildSessionVerification>> | undefined;
      if (session && (cli.json || cli.sessionResult || cli.verifySession)) {
        sessionResult = await buildSessionResult(store, session.id);
      }
      if (session && cli.verifySession) {
        verification = await buildSessionVerification(store, session.id, {
          requireChange: cli.requireChange,
          requirePatch: cli.requirePatch,
          requireRecovery: cli.requireRecovery,
          requireTimeout: cli.requireTimeout,
          requireDiffStat: cli.requireDiffStat,
          requiredExecutionProfiles: cli.requiredExecutionProfiles,
          requiredApprovalActions: cli.requiredApprovalActions,
          requireCommand: cli.allowNoCommand !== true,
        });
      }
      if (cli.json) {
        console.log(JSON.stringify({
          generatedAt: new Date().toISOString(),
          workspace,
          session,
          finalAnswer,
          result: sessionResult,
          verification,
          reviewCommands: session
            ? {
                review: `agent session review ${session.id}`,
                result: `agent session result ${session.id}`,
                verify: `agent session verify ${session.id}`,
                diff: `agent session diff ${session.id}`,
                report: `agent session report ${session.id} --json`,
              }
            : undefined,
        }, null, 2));
      } else {
        console.log(finalAnswer);
        if (session) {
          console.log("");
          console.log(`session: ${session.id}`);
          console.log(`review: agent session review ${session.id}`);
        }
        if (sessionResult && cli.sessionResult) {
          console.log("");
          printSessionResult(sessionResult);
        }
        if (verification) {
          console.log("");
          printSessionVerification(verification);
        }
      }
      if (verification?.status === "fail") {
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "pause" || command === "cancel") {
    const sessionId = rest[0];
    const reason = rest.slice(1).join(" ").trim() || undefined;
    if (!sessionId) {
      console.error("Missing session id.");
      process.exitCode = 1;
      return;
    }
    const { tasks, store } = await createLocalPlatform(process.cwd());
    const actor = { type: "user" as const, id: "local-user", displayName: "Local User" };
    try {
      const session =
        command === "pause"
          ? await tasks.pause({ sessionId, actor, reason })
          : await tasks.cancel({ sessionId, actor, reason });
      console.log(`${session.id}\t${session.status}\t${session.updatedAt}\t${session.objective}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "identity") {
    const subcommand = rest[0] ?? "show";
    const { identity, store } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "show" || subcommand === "init") {
        const displayName = readOption(rest.slice(1), "--display-name");
        const result = await identity.show();
        const agent = displayName ? await identity.getOrCreate(displayName) : result.identity;
        console.log(
          JSON.stringify(
            {
              id: agent.id,
              machineId: agent.machineId,
              displayName: agent.displayName,
              fingerprint: agent.fingerprint,
              trustStatus: agent.trustStatus,
              capabilities: agent.capabilities,
              privateKeyPath: result.privateKeyPath,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.error(`Unknown identity command: ${subcommand}`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "agents") {
    const { store, agentHealth } = await createLocalPlatform(process.cwd());
    try {
      if (rest[0] === "health") {
        const args = rest.slice(1);
        const limit = Number(readOption(args, "--limit") ?? "1000");
        const summary = await agentHealth.getSummary({
          now: readOption(args, "--now"),
          limit: Number.isFinite(limit) ? limit : 1000,
        });
        if (args.includes("--json")) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(
            `agents total=${summary.agents.total} responsive=${summary.agents.responsive} stale=${summary.agents.stale} failing=${summary.agents.failing}`,
          );
          for (const agent of summary.perAgent) {
            console.log(
              `${agent.agentId}\t${agent.healthState}\t${agent.trustStatus}\t${agent.machineId}\troom=${agent.lastRoomId ?? "-"}\theartbeat=${agent.lastHeartbeatAt ?? "-"}\t${agent.displayName}`,
            );
          }
        }
        return;
      }
      const limit = Number(readOption(rest, "--limit") ?? "20");
      const agents = await store.listAgents(Number.isFinite(limit) ? limit : 20);
      for (const agent of agents) {
        console.log(`${agent.id}\t${agent.trustStatus}\t${agent.fingerprint}\t${agent.displayName}`);
      }
    } finally {
      store.close();
    }
    return;
  }

  if (command === "operator") {
    const subcommand = rest[0] ?? "status";
    const args = subcommand === "status" || subcommand === "view" || subcommand === "show" ? rest.slice(1) : rest;
    if (subcommand !== "status" && subcommand !== "view" && subcommand !== "show") {
      console.error(`Unknown operator command: ${subcommand}`);
      process.exitCode = 1;
      return;
    }
    const options = parseOperatorArgs(args);
    const platform = await createLocalPlatform(process.cwd());
    const control = new ControlPlaneService(platform);
    try {
      const projectionRequest = { operatorProjection: options.publicView ? "public" as const : "diagnostic" as const, operatorActor: options.actor };
      const state = await control.getState(projectionRequest);
      const operatorView = state.operator;
      if (subcommand === "show") {
        const selectedItem = options.select === undefined ? undefined : selectOperatorItem(operatorView, options);
        const itemId = selectedItem?.id ?? options.id ?? options.positionals[0];
        if (!itemId) {
          console.error("Usage: agent operator show <item-id-or-ref-id> [--select n] [--json]");
          process.exitCode = 1;
          return;
        }
        const detail = await control.getOperatorDetail(itemId, projectionRequest);
        if (!detail.item) {
          console.error(`Operator item not found: ${itemId}`);
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(detail, null, 2));
        } else {
          printOperatorDetail(detail);
        }
      } else if (options.json) {
        console.log(JSON.stringify(operatorJsonView(operatorView, options), null, 2));
      } else {
        printOperatorView(operatorView, options);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      platform.locks.close?.();
      platform.store.close?.();
    }
    return;
  }

  if (command === "remote") {
    const subcommand = rest[0] ?? "help";
    const args = rest.slice(1);
    if (subcommand === "enroll") {
      const parsed = parseRemoteArgs(args);
      if (!parsed.options.controlUrl || !parsed.options.roomId || !parsed.options.inviteToken) {
        console.error("Usage: agent remote enroll --control-url url [--control-token token] --room room-id --invite-token token [--alias alias] [--display-name name] [--json]");
        process.exitCode = 1;
        return;
      }
      const controlToken = parsed.options.controlToken ?? process.env.AGENT_CONTROL_TOKEN ?? process.env.AGENT_WEB_TOKEN;
      if (!controlToken) {
        console.error("Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        process.exitCode = 1;
        return;
      }
      const platform = await createLocalPlatform(process.cwd());
      const { identity, localAgent, store, locks } = platform;
      try {
        const shown = await identity.show();
        const displayName = parsed.options.displayName ?? localAgent.displayName;
        const actor = `agent:${localAgent.id}`;
        const registration = await controlPlaneJson<{ agent: typeof localAgent }>(parsed.options.controlUrl, "/api/agents/register", controlToken, {
          actor,
          agentId: localAgent.id,
          machineId: localAgent.machineId,
          orgId: localAgent.orgId,
          displayName,
          publicKeyPem: localAgent.publicKeyPem,
          fingerprint: localAgent.fingerprint,
          capabilities: localAgent.capabilities,
          allowedProjects: localAgent.allowedProjects,
        });
        const join = await controlPlaneJson<{ member: { actor: ActorRef; role: string; status: string; aliases?: string[] } }>(
          parsed.options.controlUrl,
          `/api/rooms/${encodeURIComponent(parsed.options.roomId)}/join-invite`,
          controlToken,
          {
            actor,
            token: parsed.options.inviteToken,
            aliases: parsed.options.aliases,
          },
        );
        const result = {
          agent: registration.agent,
          member: join.member,
          privateKeyPath: shown.privateKeyPath,
        };
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`agent\t${registration.agent.id}\t${registration.agent.trustStatus}\t${registration.agent.fingerprint}`);
          console.log(`member\t${join.member.actor.type}:${join.member.actor.id}\t${join.member.role}\t${join.member.status}\t${(join.member.aliases ?? []).join(",")}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        locks.close();
        store.close();
      }
      return;
    }
    if (subcommand === "inbox") {
      const parsed = parseRemoteArgs(args);
      if (!parsed.options.controlUrl || !parsed.options.roomId) {
        console.error("Usage: agent remote inbox --control-url url [--control-token token] --room room-id [--limit n] [--include-delivered] [--json]");
        process.exitCode = 1;
        return;
      }
      const controlToken = parsed.options.controlToken ?? process.env.AGENT_CONTROL_TOKEN ?? process.env.AGENT_WEB_TOKEN;
      if (!controlToken) {
        console.error("Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        process.exitCode = 1;
        return;
      }
      const platform = await createLocalPlatform(process.cwd());
      const { identity, localAgent, store, locks } = platform;
      try {
        const runner = new RemoteRoomRunner({
          controlUrl: parsed.options.controlUrl,
          token: controlToken,
          roomId: parsed.options.roomId,
          identity,
          localAgent,
        });
        const inbox = await runner.inbox({ limit: parsed.options.limit ?? 50, includeDelivered: parsed.options.includeDelivered });
        if (parsed.options.json) {
          console.log(JSON.stringify(inbox, null, 2));
        } else {
          for (const message of inbox.messages) {
            console.log(`${message.id}\t${message.kind}\t${message.signatureStatus ?? "-"}\t${message.activationContext?.reason ?? "-"}\t${message.createdAt}\t${message.body.replace(/\s+/g, " ").slice(0, 160)}`);
          }
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        locks.close();
        store.close();
      }
      return;
    }
    if (subcommand === "ack") {
      const parsed = parseRemoteArgs(args);
      if (!parsed.options.controlUrl || !parsed.options.roomId) {
        console.error("Usage: agent remote ack --control-url url [--control-token token] --room room-id [--message-id message-id] [--json]");
        process.exitCode = 1;
        return;
      }
      const controlToken = parsed.options.controlToken ?? process.env.AGENT_CONTROL_TOKEN ?? process.env.AGENT_WEB_TOKEN;
      if (!controlToken) {
        console.error("Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        process.exitCode = 1;
        return;
      }
      const platform = await createLocalPlatform(process.cwd());
      const { identity, localAgent, store, locks } = platform;
      try {
        const runner = new RemoteRoomRunner({
          controlUrl: parsed.options.controlUrl,
          token: controlToken,
          roomId: parsed.options.roomId,
          identity,
          localAgent,
        });
        const messageId = parsed.options.messageId ?? (await runner.latestInboxMessageId());
        if (!messageId) {
          throw new Error("No routed inbox message to acknowledge.");
        }
        const result = await runner.ack(messageId);
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`ack\t${result.cursor.agentId}\t${result.cursor.lastDeliveredMessageId}\t${result.cursor.lastAckEnvelope?.signature ? "signed" : "unsigned"}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        locks.close();
        store.close();
      }
      return;
    }
    if (subcommand === "poll") {
      const parsed = parseRemoteArgs(args);
      if (!parsed.options.controlUrl || !parsed.options.roomId) {
        console.error("Usage: agent remote poll --control-url url [--control-token token] --room room-id [--limit n] [--idle-limit n] [--interval-ms n] [--json]");
        process.exitCode = 1;
        return;
      }
      const controlToken = parsed.options.controlToken ?? process.env.AGENT_CONTROL_TOKEN ?? process.env.AGENT_WEB_TOKEN;
      if (!controlToken) {
        console.error("Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        process.exitCode = 1;
        return;
      }
      const platform = await createLocalPlatform(process.cwd());
      const { identity, localAgent, store, locks } = platform;
      try {
        const runner = new RemoteRoomRunner({
          controlUrl: parsed.options.controlUrl,
          token: controlToken,
          roomId: parsed.options.roomId,
          identity,
          localAgent,
        });
        const result = await runner.poll({
          maxMessages: parsed.options.limit ?? 10,
          maxIdlePolls: parsed.options.maxIdlePolls ?? 1,
          idleIntervalMs: parsed.options.idleIntervalMs ?? 1000,
          onMessage: parsed.options.json
            ? undefined
            : (message, ack) => {
                console.log(`${message.id}\t${message.kind}\t${message.signatureStatus ?? "-"}\t${message.activationContext?.reason ?? "-"}\t${message.createdAt}\t${message.body.replace(/\s+/g, " ").slice(0, 160)}`);
                console.log(`ack\t${ack.cursor.agentId}\t${ack.cursor.lastDeliveredMessageId}\t${ack.cursor.lastAckEnvelope?.signature ? "signed" : "unsigned"}`);
              },
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`poll\t${result.agentId}\t${result.stopReason}\tprocessed=${result.messagesProcessed}\tidle=${result.idlePolls}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        locks.close();
        store.close();
      }
      return;
    }
    if (subcommand === "heartbeat") {
      const parsed = parseRemoteArgs(args);
      if (!parsed.options.controlUrl || !parsed.options.roomId) {
        console.error("Usage: agent remote heartbeat --control-url url [--control-token token] --room room-id [--status online|idle|running|error|offline] [--ttl seconds] [--last-error text] [--json]");
        process.exitCode = 1;
        return;
      }
      const controlToken = parsed.options.controlToken ?? process.env.AGENT_CONTROL_TOKEN ?? process.env.AGENT_WEB_TOKEN;
      if (!controlToken) {
        console.error("Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        process.exitCode = 1;
        return;
      }
      const platform = await createLocalPlatform(process.cwd());
      const { identity, localAgent, store, locks } = platform;
      try {
        const runner = new RemoteRoomRunner({
          controlUrl: parsed.options.controlUrl,
          token: controlToken,
          roomId: parsed.options.roomId,
          identity,
          localAgent,
        });
        const result = await runner.heartbeat({
          status: parsed.options.heartbeatStatus ?? "online",
          ttlSeconds: parsed.options.ttlSeconds ?? 60,
          lastError: parsed.options.lastError,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`heartbeat\t${result.agent.id}\t${result.agent.heartbeatStatus ?? "-"}\texpires=${result.agent.heartbeatExpiresAt ?? "-"}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        locks.close();
        store.close();
      }
      return;
    }
    if (subcommand === "run") {
      const parsed = parseRemoteArgs(args);
      if (!parsed.options.controlUrl || !parsed.options.roomId) {
        console.error("Usage: agent remote run --control-url url [--control-token token] --room room-id [--cycles n] [--limit n] [--idle-limit n] [--interval-ms n] [--loop-interval-ms n] [--stop-when-idle] [--idle-cycles n] [--backoff-ms n] [--max-backoff-ms n] [--max-errors n] [--heartbeat-ttl seconds] [--json]");
        process.exitCode = 1;
        return;
      }
      const controlToken = parsed.options.controlToken ?? process.env.AGENT_CONTROL_TOKEN ?? process.env.AGENT_WEB_TOKEN;
      if (!controlToken) {
        console.error("Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        process.exitCode = 1;
        return;
      }
      const platform = await createLocalPlatform(process.cwd());
      const { identity, localAgent, store, locks } = platform;
      try {
        const runner = new RemoteRoomRunner({
          controlUrl: parsed.options.controlUrl,
          token: controlToken,
          roomId: parsed.options.roomId,
          identity,
          localAgent,
        });
        const result = await runner.run({
          maxCycles: parsed.options.maxCycles ?? 10,
          maxMessagesPerPoll: parsed.options.limit ?? 10,
          maxIdlePolls: parsed.options.maxIdlePolls ?? 1,
          idleIntervalMs: parsed.options.idleIntervalMs ?? 1000,
          intervalMs: parsed.options.loopIntervalMs ?? 1000,
          stopWhenIdle: parsed.options.stopWhenIdle,
          maxIdleCycles: parsed.options.maxIdleCycles ?? 1,
          baseBackoffMs: parsed.options.baseBackoffMs ?? 1000,
          maxBackoffMs: parsed.options.maxBackoffMs ?? 30000,
          maxErrors: parsed.options.maxErrors ?? 3,
          heartbeatTtlSeconds: parsed.options.heartbeatTtlSeconds ?? 60,
          onPoll: parsed.options.json
            ? undefined
            : (poll) => {
                console.log(`cycle\t${poll.agentId}\t${poll.stopReason}\tprocessed=${poll.messagesProcessed}\tidle=${poll.idlePolls}`);
                for (const ack of poll.acknowledgements) {
                  console.log(`ack\t${poll.agentId}\t${ack.messageId}\t${ack.ackSignature ? "signed" : "unsigned"}`);
                }
              },
          onError: parsed.options.json
            ? undefined
            : (error, cycle) => {
                console.error(`cycle-error\t${cycle}\t${error.message}`);
              },
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`run\t${result.agentId}\t${result.stopReason}\tcycles=${result.cycles}\tprocessed=${result.messagesProcessed}\terrors=${result.errors.length}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        locks.close();
        store.close();
      }
      return;
    }
    console.error(`Unknown remote command: ${subcommand}`);
    process.exitCode = 1;
    return;
  }

  if (command === "workers") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { workers, workerRunner, workerHealth, store, localAgent, identity } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "register") {
        const parsed = parseWorkerArgs(args);
        const worker = await workers.register({
          actor: parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor),
          agentId: parsed.options.agentId ?? localAgent.id,
          machineId: parsed.options.machineId ?? localAgent.machineId,
          orgId: parsed.options.orgId ?? localAgent.orgId,
          displayName: parsed.options.displayName ?? localAgent.displayName,
          endpoint: parsed.options.endpoint,
          capabilities: parsed.options.capabilities,
          allowedProjects: parsed.options.allowedProjects,
          maxConcurrentTasks: parsed.options.maxConcurrentTasks,
          metadata: parsed.options.metadataJson ? (JSON.parse(parsed.options.metadataJson) as Record<string, unknown>) : undefined,
          ttlSeconds: parsed.options.ttlSeconds,
        });
        printWorker(worker);
        return;
      }
      if (subcommand === "heartbeat") {
        const parsed = parseWorkerArgs(args);
        const workerId = parsed.positionals[0];
        if (!workerId) {
          console.error("Usage: agent workers heartbeat <worker-id> [--status online|offline|draining|suspended] [--load n] [--max-tasks n] [--ttl seconds]");
          process.exitCode = 1;
          return;
        }
        const worker = await workers.heartbeat({
          workerId,
          actor: parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor),
          status: parsed.options.status,
          currentLoad: parsed.options.currentLoad,
          maxConcurrentTasks: parsed.options.maxConcurrentTasks,
          metadata: parsed.options.metadataJson ? (JSON.parse(parsed.options.metadataJson) as Record<string, unknown>) : undefined,
          ttlSeconds: parsed.options.ttlSeconds,
        });
        printWorker(worker);
        return;
      }
      if (subcommand === "drain") {
        const parsed = parseWorkerArgs(args);
        const workerId = parsed.positionals[0];
        const reason = parsed.positionals.slice(1).join(" ").trim() || undefined;
        if (!workerId) {
          console.error("Usage: agent workers drain <worker-id> [reason] [--ttl seconds] [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const worker = await workers.drain({
          workerId,
          actor: parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor),
          reason,
          ttlSeconds: parsed.options.ttlSeconds,
        });
        printWorker(worker);
        return;
      }
      if (subcommand === "complete-drain") {
        const parsed = parseWorkerArgs(args);
        const workerId = parsed.positionals[0];
        const reason = parsed.positionals.slice(1).join(" ").trim() || undefined;
        if (!workerId) {
          console.error("Usage: agent workers complete-drain <worker-id> [reason] [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const worker = await workers.completeDrain({
          workerId,
          actor: parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor),
          reason,
        });
        printWorker(worker);
        return;
      }
      if (subcommand === "verify-heartbeat") {
        const workerId = args[0];
        if (!workerId) {
          console.error("Usage: agent workers verify-heartbeat <worker-id>");
          process.exitCode = 1;
          return;
        }
        const worker = await workers.get(workerId);
        if (!worker) {
          console.error(`Worker not found: ${workerId}`);
          process.exitCode = 1;
          return;
        }
        const envelope = worker.metadata?.heartbeatEnvelope;
        if (!isWorkerHeartbeatEnvelope(envelope)) {
          console.log("unsigned");
          return;
        }
        const status = await identity.verifyWorkerHeartbeatEnvelope(envelope);
        console.log(status);
        if (status !== "valid") {
          process.exitCode = 2;
        }
        return;
      }
      if (subcommand === "recover-expired") {
        const parsed = parseWorkerArgs(args);
        const result = await workers.recoverExpired({
          actor: parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor),
          limit: parsed.options.limit,
        });
        for (const worker of result.expired) {
          console.log(`${worker.id}\t${worker.status}\texpiredAt=${worker.metadata?.expiredAt ?? "-"}\t${worker.displayName}`);
        }
        if (result.expired.length === 0) {
          console.log("no expired workers");
        }
        return;
      }
      if (subcommand === "cleanup-nonces") {
        const parsed = parseWorkerArgs(args);
        const result = await workers.cleanupHeartbeatNonces({
          actor: parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor),
          before: parsed.options.before,
          limit: parsed.options.limit,
        });
        console.log(`deleted=${result.deleted}\tbefore=${result.before}`);
        return;
      }
      if (subcommand === "health") {
        const parsed = parseWorkerArgs(args);
        const summary = await workerHealth.getSummary({
          now: parsed.options.now,
          limit: parsed.options.limit,
        });
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      if (subcommand === "run-once") {
        const parsed = parseWorkerArgs(args);
        const workerId = parsed.positionals[0];
        if (!workerId) {
          console.error("Usage: agent workers run-once <worker-id> [--ttl seconds] [--require-signed-lease] [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const result = await workerRunner.runOnce({
          workerId,
          leaseTtlSeconds: parsed.options.ttlSeconds,
          actor: parsed.options.actor ? parseActorRef(parsed.options.actor) : agentActor(localAgent),
          requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
        });
        printWorkerRunOnce(result);
        return;
      }
      if (subcommand === "poll") {
        const parsed = parseWorkerArgs(args);
        const workerId = parsed.positionals[0];
        if (!workerId) {
          console.error("Usage: agent workers poll <worker-id> [--limit n] [--idle-limit n] [--interval-ms n] [--ttl seconds] [--require-signed-lease] [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const result = await workerRunner.poll({
          workerId,
          leaseTtlSeconds: parsed.options.ttlSeconds,
          actor: parsed.options.actor ? parseActorRef(parsed.options.actor) : agentActor(localAgent),
          maxRuns: parsed.options.limit,
          maxIdlePolls: parsed.options.maxIdlePolls,
          idleIntervalMs: parsed.options.idleIntervalMs,
          requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
        });
        printWorkerPoll(result);
        return;
      }
      if (subcommand === "list") {
        const parsed = parseWorkerArgs(args);
        const all = await workers.list({
          status: parsed.options.status,
          agentId: parsed.options.agentId,
          machineId: parsed.options.machineId,
          orgId: parsed.options.orgId,
          projectId: parsed.options.projectId,
          limit: parsed.options.limit,
        });
        for (const worker of all) {
          printWorker(worker);
        }
        return;
      }
      console.error(`Unknown workers command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "scheduler") {
    const subcommand = rest[0] ?? "tick";
    const args = rest.slice(1);
    const { scheduler, store, localAgent } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "tick") {
        const parsed = parseSchedulerArgs(args);
        const result = await scheduler.tick({
          actor: parsed.options.actor ? parseActorRef(parsed.options.actor) : agentActor(localAgent),
          workerId: parsed.options.workerId,
          requireSignedWorkerHeartbeat: parsed.options.requireSignedWorkerHeartbeat,
          requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
          leaseTtlSeconds: parsed.options.leaseTtlSeconds,
          maxAttempts: parsed.options.maxAttempts,
          baseBackoffMs: parsed.options.baseBackoffMs,
          maxBackoffMs: parsed.options.maxBackoffMs,
          jitterMs: parsed.options.jitterMs,
          recoverLimit: parsed.options.recoverLimit,
          maxRunsPerWorker: parsed.options.maxRunsPerWorker,
          maxIdlePolls: parsed.options.maxIdlePolls,
          idleIntervalMs: parsed.options.idleIntervalMs,
          dispatchSpecId: parsed.options.dispatchSpecId,
          dispatchLimit: parsed.options.dispatchLimit,
          dispatchWorkerId: parsed.options.dispatchWorkerId,
          dispatchAutoSelectWorker: parsed.options.dispatchAutoSelectWorker,
          dispatchPriority: parsed.options.dispatchPriority,
          dispatchMaxLoadRatio: parsed.options.dispatchMaxLoadRatio,
          dispatchMaxQueuedAssignmentsPerWorker: parsed.options.dispatchMaxQueuedAssignmentsPerWorker,
          completeDrainedWorkers: parsed.options.completeDrainedWorkers,
          warnLoadRatio: parsed.options.warnLoadRatio,
          warnQueueRatio: parsed.options.warnQueueRatio,
        });
        printSchedulerTick(result);
        return;
      }
      if (subcommand === "run") {
        const parsed = parseSchedulerArgs(args);
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        try {
          const result = await scheduler.run({
            actor: parsed.options.actor ? parseActorRef(parsed.options.actor) : agentActor(localAgent),
            workerId: parsed.options.workerId,
            requireSignedWorkerHeartbeat: parsed.options.requireSignedWorkerHeartbeat,
            requireSignedLeaseEnvelope: parsed.options.requireSignedLeaseEnvelope,
            leaseTtlSeconds: parsed.options.leaseTtlSeconds,
            maxAttempts: parsed.options.maxAttempts,
            baseBackoffMs: parsed.options.baseBackoffMs,
            maxBackoffMs: parsed.options.maxBackoffMs,
            jitterMs: parsed.options.jitterMs,
            recoverLimit: parsed.options.recoverLimit,
            maxRunsPerWorker: parsed.options.maxRunsPerWorker,
            maxIdlePolls: parsed.options.maxIdlePolls,
            idleIntervalMs: parsed.options.idleIntervalMs,
            dispatchSpecId: parsed.options.dispatchSpecId,
            dispatchLimit: parsed.options.dispatchLimit,
            dispatchWorkerId: parsed.options.dispatchWorkerId,
            dispatchAutoSelectWorker: parsed.options.dispatchAutoSelectWorker,
            dispatchPriority: parsed.options.dispatchPriority,
            dispatchMaxLoadRatio: parsed.options.dispatchMaxLoadRatio,
            dispatchMaxQueuedAssignmentsPerWorker: parsed.options.dispatchMaxQueuedAssignmentsPerWorker,
            completeDrainedWorkers: parsed.options.completeDrainedWorkers,
            warnLoadRatio: parsed.options.warnLoadRatio,
            warnQueueRatio: parsed.options.warnQueueRatio,
            intervalMs: parsed.options.intervalMs,
            maxTicks: parsed.options.maxTicks,
            stopWhenIdle: parsed.options.stopWhenIdle,
            idleTickLimit: parsed.options.idleTickLimit,
            signal: controller.signal,
          });
          printSchedulerRun(result);
        } finally {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
        }
        return;
      }
      console.error(`Unknown scheduler command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "assignments") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { assignments, store } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "assign-session" || subcommand === "assign-subtask") {
        const parsed = parseAssignmentArgs(args);
        const targetId = parsed.positionals[0];
        if (!targetId || !parsed.options.workerId) {
          console.error(`Usage: agent assignments ${subcommand} <${subcommand === "assign-session" ? "session" : "subtask"}-id> --worker worker-id [--ttl seconds] [--priority n]`);
          process.exitCode = 1;
          return;
        }
        const assignment = await assignments.assign({
          actor: parseActorRef(parsed.options.actor),
          workerId: parsed.options.workerId,
          sessionId: subcommand === "assign-session" ? targetId : undefined,
          subtaskId: subcommand === "assign-subtask" ? targetId : undefined,
          leaseTtlSeconds: parsed.options.leaseTtlSeconds,
          priority: parsed.options.priority,
          metadata: parsed.options.metadataJson ? (JSON.parse(parsed.options.metadataJson) as Record<string, unknown>) : undefined,
        });
        printAssignment(assignment);
        return;
      }
      if (subcommand === "heartbeat") {
        const parsed = parseAssignmentArgs(args);
        const assignmentId = parsed.positionals[0];
        if (!assignmentId || !parsed.options.workerId) {
          console.error("Usage: agent assignments heartbeat <assignment-id> --worker worker-id [--ttl seconds]");
          process.exitCode = 1;
          return;
        }
        const assignment = await assignments.heartbeat({
          actor: parseActorRef(parsed.options.actor),
          assignmentId,
          workerId: parsed.options.workerId,
          leaseTtlSeconds: parsed.options.leaseTtlSeconds,
          metadata: parsed.options.metadataJson ? (JSON.parse(parsed.options.metadataJson) as Record<string, unknown>) : undefined,
        });
        printAssignment(assignment);
        return;
      }
      if (subcommand === "complete" || subcommand === "fail" || subcommand === "cancel") {
        const parsed = parseAssignmentArgs(args);
        const assignmentId = parsed.positionals[0];
        const resultSummary = parsed.positionals.slice(1).join(" ").trim() || undefined;
        if (!assignmentId || !parsed.options.workerId) {
          console.error(`Usage: agent assignments ${subcommand} <assignment-id> --worker worker-id [summary]`);
          process.exitCode = 1;
          return;
        }
        const assignment = await assignments.complete({
          actor: parseActorRef(parsed.options.actor),
          assignmentId,
          workerId: parsed.options.workerId,
          status: subcommand === "complete" ? "completed" : subcommand === "fail" ? "failed" : "cancelled",
          resultSummary,
        });
        printAssignment(assignment);
        return;
      }
      if (subcommand === "list") {
        const parsed = parseAssignmentArgs(args);
        const all = await assignments.list({
          status: parsed.options.status,
          workerId: parsed.options.workerId,
          sessionId: parsed.options.sessionId,
          subtaskId: parsed.options.subtaskId,
          projectId: parsed.options.projectId,
          roomId: parsed.options.roomId,
          limit: parsed.options.limit,
        });
        for (const assignment of all) {
          printAssignment(assignment);
        }
        return;
      }
      if (subcommand === "recover-expired") {
        const parsed = parseAssignmentArgs(args);
        const result = await assignments.recoverExpired({
          actor: parseActorRef(parsed.options.actor),
          retryWorkerId: parsed.options.retryWorkerId,
          autoSelectRetryWorker: parsed.options.autoSelectRetryWorker,
          leaseTtlSeconds: parsed.options.leaseTtlSeconds,
          maxAttempts: parsed.options.maxAttempts,
          baseBackoffMs: parsed.options.baseBackoffMs,
          maxBackoffMs: parsed.options.maxBackoffMs,
          jitterMs: parsed.options.jitterMs,
          limit: parsed.options.limit,
          exhaustedTargetStatus: parsed.options.exhaustedTargetStatus,
          metadata: parsed.options.metadataJson ? (JSON.parse(parsed.options.metadataJson) as Record<string, unknown>) : undefined,
        });
        printAssignmentRecovery(result);
        return;
      }
      if (subcommand === "cleanup-nonces") {
        const parsed = parseAssignmentArgs(args);
        const result = await assignments.cleanupLeaseNonces({
          actor: parseActorRef(parsed.options.actor),
          before: parsed.options.before,
          limit: parsed.options.limit,
        });
        console.log(`deleted=${result.deleted}\tbefore=${result.before}`);
        return;
      }
      console.error(`Unknown assignments command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "orgs") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { organizations, store } = await createLocalPlatform(process.cwd());
    const actor = localUserActor();
    try {
      if (subcommand === "create") {
        const name = args.join(" ").trim();
        if (!name) {
          console.error("Usage: agent orgs create <name>");
          process.exitCode = 1;
          return;
        }
        const org = await organizations.createOrganization({ name, createdBy: actor });
        console.log(`${org.id}\t${org.status}\t${org.name}`);
        return;
      }
      if (subcommand === "list") {
        for (const org of await organizations.listOrganizations()) {
          console.log(`${org.id}\t${org.status}\t${org.createdAt}\t${org.name}`);
        }
        return;
      }
      if (subcommand === "project-create") {
        const orgId = args[0];
        const parsed = parseOrgArgs(args.slice(1));
        const name = parsed.positionals.join(" ").trim();
        if (!orgId || !name) {
          console.error("Usage: agent orgs project-create <org-id> [--default-role viewer|member|admin] <name>");
          process.exitCode = 1;
          return;
        }
        const project = await organizations.createProject({
          orgId,
          name,
          defaultRole: parsed.options.defaultRole,
          retentionPolicyId: parsed.options.retentionPolicyId,
          createdBy: actor,
        });
        console.log(`${project.id}\t${project.orgId}\t${project.status}\t${project.name}`);
        return;
      }
      if (subcommand === "projects") {
        const orgId = args[0];
        for (const project of await organizations.listProjects(orgId)) {
          console.log(`${project.id}\t${project.orgId}\t${project.status}\t${project.createdAt}\t${project.name}`);
        }
        return;
      }
      if (subcommand === "grant") {
        const [scopeType, scopeId, subject, capability] = args;
        const parsed = parseOrgArgs(args.slice(4));
        if (!scopeType || !scopeId || !subject || !capability) {
          console.error("Usage: agent orgs grant <organization|project|room|session|operator> <scope-id> <user:id|agent:id|service_account:id> <capability> [--expires-at iso]");
          process.exitCode = 1;
          return;
        }
        const subjectRef = parseCapabilitySubject(subject);
        const scope = parseCapabilityScope(scopeType);
        const grant = await organizations.grantCapability({
          subjectType: subjectRef.subjectType,
          subjectId: subjectRef.subjectId,
          scopeType: scope,
          scopeId,
          capability,
          expiresAt: parsed.options.expiresAt,
          grantedBy: actor,
        });
        console.log(`${grant.scopeType}:${grant.scopeId}\t${grant.subjectType}:${grant.subjectId}\t${grant.capability}\texpires=${grant.expiresAt ?? "-"}`);
        return;
      }
      if (subcommand === "grants") {
        const parsed = parseOrgArgs(args);
        const subjectRef = parsed.options.subject ? parseCapabilitySubject(parsed.options.subject) : undefined;
        const grants = await organizations.listCapabilityGrants({
          subjectType: subjectRef?.subjectType,
          subjectId: subjectRef?.subjectId,
          scopeType: parsed.options.scopeType,
          scopeId: parsed.options.scopeId,
        });
        for (const grant of grants) {
          console.log(`${grant.scopeType}:${grant.scopeId}\t${grant.subjectType}:${grant.subjectId}\t${grant.capability}\tby=${grant.grantedBy}\texpires=${grant.expiresAt ?? "-"}`);
        }
        return;
      }
      if (subcommand === "can") {
        const [scopeType, scopeId, subject, capability] = args;
        if (!scopeType || !scopeId || !subject || !capability) {
          console.error("Usage: agent orgs can <organization|project|room|session|operator> <scope-id> <user:id|agent:id|service_account:id> <capability>");
          process.exitCode = 1;
          return;
        }
        const subjectRef = parseCapabilitySubject(subject);
        const scope = parseCapabilityScope(scopeType);
        const ok = await organizations.hasCapability({
          subjectType: subjectRef.subjectType,
          subjectId: subjectRef.subjectId,
          scopeType: scope,
          scopeId,
          capability,
        });
        console.log(ok ? "allow" : "deny");
        return;
      }
      console.error(`Unknown orgs command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "retention") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { lifecycle, store } = await createLocalPlatform(process.cwd());
    const actor = localUserActor();
    try {
      if (subcommand === "create") {
        const parsed = parseRetentionArgs(args);
        const name = parsed.positionals.join(" ").trim();
        if (!name) {
          console.error("Usage: agent retention create <name> [--hot-days n] [--artifact-days n] [--audit-days n] [--no-auto-summaries] [--no-user-delete] [--no-audit-export]");
          process.exitCode = 1;
          return;
        }
        const policy = await lifecycle.createRetentionPolicy({
          name,
          hotTranscriptDays: parsed.options.hotTranscriptDays ?? 30,
          artifactRetentionDays: parsed.options.artifactRetentionDays ?? 90,
          auditRetentionDays: parsed.options.auditRetentionDays ?? 365,
          enableAutoSummaries: parsed.options.enableAutoSummaries ?? true,
          allowUserDeletion: parsed.options.allowUserDeletion ?? true,
          allowAuditExport: parsed.options.allowAuditExport ?? true,
        }, actor);
        console.log(`${policy.id}\t${policy.name}\thot=${policy.hotTranscriptDays}\tartifacts=${policy.artifactRetentionDays}\taudit=${policy.auditRetentionDays}`);
        return;
      }
      if (subcommand === "list") {
        for (const policy of await store.listRetentionPolicies()) {
          console.log(
            `${policy.id}\t${policy.name}\thot=${policy.hotTranscriptDays}\tartifacts=${policy.artifactRetentionDays}\taudit=${policy.auditRetentionDays}\tauto=${policy.enableAutoSummaries}\tdelete=${policy.allowUserDeletion}`,
          );
        }
        return;
      }
      if (subcommand === "assign") {
        const [projectId, policyId] = args;
        if (!projectId || !policyId) {
          console.error("Usage: agent retention assign <project-id> <policy-id>");
          process.exitCode = 1;
          return;
        }
        const project = await lifecycle.assignProjectPolicy(projectId, policyId, actor);
        console.log(`${project.id}\tretention=${project.retentionPolicyId ?? "-"}`);
        return;
      }
      if (subcommand === "apply") {
        const projectId = args[0];
        if (!projectId) {
          console.error("Usage: agent retention apply <project-id>");
          process.exitCode = 1;
          return;
        }
        const result = await lifecycle.applyProjectRetention(projectId, actor);
        console.log(
          `${result.projectId}\tpolicy=${result.policy.id}\tsessions_compacted=${result.sessionsCompacted}\tartifacts_deleted=${result.artifactsDeleted}\taudit_deleted=${result.auditEventsDeleted}`,
        );
        return;
      }
      console.error(`Unknown retention command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "git") {
    const subcommand = rest[0] ?? "status";
    const { git, store } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "status") {
        console.log(JSON.stringify(await git.status(readOption(rest.slice(1), "--remote") ?? "origin"), null, 2));
        return;
      }
      console.error(`Unknown git command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "pr") {
    const subcommand = rest[0] ?? "prepare";
    if (subcommand !== "prepare") {
      console.error(`Unknown pr command: ${subcommand}`);
      process.exitCode = 1;
      return;
    }
    const parsed = await parsePrArgs(rest.slice(1));
    const { git, policy, store } = await createLocalPlatform(process.cwd());
    const actor = { type: "user" as const, id: "local-user", displayName: "Local User" };
    try {
      if (!parsed.input.dryRun) {
        await ensureGitPolicyAllowed({
          action: "git.branch.create",
          mode: parsed.executionMode,
          actor,
          policy,
          store,
          summary: `Create or switch PR branch ${parsed.input.branch ?? "(auto)"}`,
        });
        if (parsed.input.commit) {
          await ensureGitPolicyAllowed({
            action: "git.commit.create",
            mode: parsed.executionMode,
            actor,
            policy,
            store,
            summary: `Create PR commit for ${parsed.input.title}`,
          });
        }
        if (parsed.input.push) {
          await ensureGitPolicyAllowed({
            action: "git.push",
            mode: parsed.executionMode,
            actor,
            policy,
            store,
            summary: `Push PR branch ${parsed.input.branch ?? "(auto)"}`,
          });
        }
      }
      const result = await git.preparePullRequest(parsed.input);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "secrets") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { secrets, secretBroker, redactor, store } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "put") {
        const parsed = parseSecretArgs(args);
        const name = parsed.positionals[0];
        if (!name) {
          console.error("Usage: agent secrets put <name> --class model_api_key --scope-type workspace --scope-id local --value-env ENV_NAME");
          process.exitCode = 1;
          return;
        }
        const value = await secretValueFromOptions(parsed.options);
        const ref = await secrets.putSecret({
          name,
          class: parsed.options.class ?? "environment_secret",
          scopeType: parsed.options.scopeType ?? "workspace",
          scopeId: parsed.options.scopeId ?? "local",
          value,
        });
        await redactor.registerKnownSecret(ref.name, value);
        console.log(`${ref.id}\t${ref.class}\t${ref.scopeType}:${ref.scopeId}\t${ref.name}`);
        return;
      }
      if (subcommand === "get") {
        const parsed = parseSecretArgs(args);
        const id = parsed.positionals[0];
        if (!id) {
          console.error("Usage: agent secrets get <secret-id> [--purpose text] [--reveal] [--execution-mode strict|balanced|trusted|full_access]");
          process.exitCode = 1;
          return;
        }
        const lease = await secretBroker.getSecret({
          id,
          purpose: parsed.options.purpose ?? "manual_cli_access",
          actor: { type: "user", id: "local-user", displayName: "Local User" },
          mode: parsed.options.executionMode ?? "full_access",
          scope: {},
          metadata: {
            consumer: "cli.secrets.get",
            reveal: Boolean(parsed.options.reveal),
          },
        });
        try {
          if (parsed.options.reveal) {
            console.log(lease.value);
          } else {
            console.log(`${lease.ref.id}\t${lease.ref.class}\t${lease.ref.scopeType}:${lease.ref.scopeId}\t${lease.ref.name}\tlease=${lease.leaseId}\texpires=${lease.expiresAt}`);
          }
        } finally {
          await secretBroker.revokeLease(lease.leaseId);
        }
        return;
      }
      if (subcommand === "delete") {
        const id = args[0];
        if (!id) {
          console.error("Usage: agent secrets delete <secret-id>");
          process.exitCode = 1;
          return;
        }
        const deleted = secrets.deleteSecret ? await secrets.deleteSecret(id) : false;
        console.log(deleted ? "deleted" : "not found");
        return;
      }
      if (subcommand === "list") {
        const refs = secrets.listSecrets ? await secrets.listSecrets() : [];
        for (const ref of refs) {
          console.log(`${ref.id}\t${ref.class}\t${ref.scopeType}:${ref.scopeId}\t${ref.name}`);
        }
        return;
      }
      console.error(`Unknown secrets command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "models") {
    const area = rest[0] ?? "profiles";
    try {
      if (area === "usage") {
        const parsed = parseModelUsageArgs(rest.slice(1));
        const { store, locks } = await createLocalPlatform(process.cwd());
        try {
          const summary = await new ModelUsageService(store).summarize({
            filters: parsed.filters,
            provider: parsed.options.provider,
            model: parsed.options.model,
            inputCostPerMillionTokens: parsed.options.inputCostPerMillionTokens,
            outputCostPerMillionTokens: parsed.options.outputCostPerMillionTokens,
          });
          if (parsed.options.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            for (const entry of summary.entries) {
              console.log(formatModelUsageEntry(entry));
            }
            console.log(`total\t*\t${formatModelUsageStats(summary.totals)}`);
          }
        } finally {
          locks.close();
          store.close();
        }
        return;
      }
      if (area === "setup") {
        const parsed = parseModelProfileArgs(rest.slice(1));
        const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
        let providerName = parsed.options.provider ?? (providerInput ? parseModelProviderName(providerInput) : undefined);
        if (!providerName && stdin.isTTY) {
          const promptedProvider = (await promptLine("Provider [openai]: ")) || "openai";
          parsed.options.providerInput = promptedProvider;
          providerName = parseModelProviderName(promptedProvider);
        }
        if (!providerName) {
          console.error("Usage: soloclaw models setup --provider <provider> [--base-url url] [--model model] [--api-key-env ENV] [--default]");
          process.exitCode = 1;
          return;
        }
        const current = (await new LocalProviderProfileStore(`${process.cwd()}/.agent`).list()).find((profile) => profile.name === providerName);
        if (!current) {
          throw new Error(`Unknown model provider: ${providerName}`);
        }
        const profiles = new LocalProviderProfileStore(`${process.cwd()}/.agent`);
        const profile = await profiles.set({
          name: providerName,
          protocol: parsed.options.protocol ?? current.protocol,
          defaultBaseUrl: parsed.options.baseUrl ?? localModelAliasBaseUrl(parsed.options.providerInput ?? providerInput) ?? current.defaultBaseUrl,
          defaultModel: parsed.options.model ?? current.defaultModel,
          apiKeyEnvNames: resolveModelApiKeyEnvNames(parsed.options, parsed.options.providerInput ?? providerInput, current.apiKeyEnvNames),
        });
        if (parsed.options.setDefault || parsed.options.setDefault === undefined) {
          await profiles.setDefaultProvider(providerName);
        }
        const defaultProvider = await profiles.getDefaultProvider();
        console.log(`${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}\tdefault=${defaultProvider ?? "-"}`);
        console.log(`config=${profiles.filePath}`);
        return;
      }
      if (area !== "profiles") {
        console.error(`Unknown models command: ${area}`);
        process.exitCode = 1;
        return;
      }
      const subcommand = rest[1] ?? "list";
      const parsed = parseModelProfileArgs(rest.slice(2));
      const profiles = new LocalProviderProfileStore(`${process.cwd()}/.agent`);
      if (subcommand === "list") {
        const listed = await profiles.list();
        const defaultProvider = await profiles.getDefaultProvider();
        if (parsed.options.json) {
          console.log(JSON.stringify({ profiles: listed, defaultProvider, configPath: profiles.filePath }, null, 2));
        } else {
          for (const profile of listed) {
            console.log(
              `${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}${profile.name === defaultProvider ? "\tdefault" : ""}`,
            );
          }
        }
        return;
      }
      if (subcommand === "set") {
        const providerName = parsed.positionals[0];
        if (!providerName) {
          console.error("Usage: agent models profiles set <provider> [--protocol openai_chat|anthropic_messages] [--base-url url] [--model model] [--api-key-env ENV]");
          process.exitCode = 1;
          return;
        }
        const name = parseModelProviderName(providerName);
        const current = (await profiles.list()).find((profile) => profile.name === name);
        if (!current) {
          throw new Error(`Unknown model provider: ${name}`);
        }
        const profile = await profiles.set({
          name,
          protocol: parsed.options.protocol ?? current.protocol,
          defaultBaseUrl: parsed.options.baseUrl ?? current.defaultBaseUrl,
          defaultModel: parsed.options.model ?? current.defaultModel,
          apiKeyEnvNames: parsed.options.clearApiKeyEnvNames ? [] : parsed.options.apiKeyEnvNames ?? current.apiKeyEnvNames,
        });
        if (parsed.options.setDefault) {
          await profiles.setDefaultProvider(name);
        }
        console.log(`${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}`);
        return;
      }
      if (subcommand === "remove" || subcommand === "delete") {
        const providerName = parsed.positionals[0];
        if (!providerName) {
          console.error("Usage: agent models profiles remove <provider>");
          process.exitCode = 1;
          return;
        }
        const removed = await profiles.remove(parseModelProviderName(providerName));
        console.log(removed ? `removed\t${providerName}` : `not-found\t${providerName}`);
        return;
      }
      console.error(`Unknown models profiles command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "mcp") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const platform = await createLocalPlatform(process.cwd());
    const registry = new LocalMcpRegistry(path.join(process.cwd(), ".agent"));
    const actor = localUserActor();
    try {
      if (subcommand === "list") {
        const parsed = parseMcpArgs(args);
        const servers = await registry.list();
        if (parsed.options.json) {
          console.log(JSON.stringify({ servers, configPath: registry.filePath }, null, 2));
          return;
        }
        for (const server of servers) {
          console.log(formatMcpServer(server));
        }
        return;
      }
      if (subcommand === "show") {
        const id = args[0];
        if (!id) {
          console.error("Usage: agent mcp show <server-id>");
          process.exitCode = 1;
          return;
        }
        const server = await registry.get(id);
        if (!server) {
          console.error(`MCP server not found: ${id}`);
          process.exitCode = 1;
          return;
        }
        console.log(JSON.stringify(server, null, 2));
        return;
      }
      if (subcommand === "plan" || subcommand === "plan-connection") {
        const parsed = parseMcpArgs(args);
        const id = parsed.positionals[0];
        if (!id) {
          console.error("Usage: agent mcp plan <server-id> [--execution-mode strict|balanced|trusted|full_access] [--project id] [--room id] [--json]");
          process.exitCode = 1;
          return;
        }
        const plan = await new McpConnectionPlanner(registry, platform.policy, platform.store).plan({
          serverId: id,
          actor,
          mode: parsed.options.executionMode ?? "trusted",
          scope: {
            projectId: parsed.options.scopeProjectId,
            roomId: parsed.options.scopeRoomId,
          },
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          console.log(formatMcpConnectionPlan(plan));
        }
        if (plan.status === "deny") {
          process.exitCode = 1;
        }
        return;
      }
      if (subcommand === "capabilities" || subcommand === "list-capabilities") {
        const parsed = parseMcpArgs(args);
        const id = parsed.positionals[0];
        if (!id) {
          console.error("Usage: agent mcp capabilities <server-id> [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]");
          process.exitCode = 1;
          return;
        }
        const result = await createMcpExecutionService(registry, platform).execute({
          serverId: id,
          actor,
          mode: parsed.options.executionMode ?? "trusted",
          scope: {
            projectId: parsed.options.scopeProjectId,
            roomId: parsed.options.scopeRoomId,
          },
          operation: { type: "list_capabilities" },
          timeoutMs: parsed.options.timeoutMs,
          secretEnvMap: parsed.options.secretEnvMap,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatMcpExecutionResult(result));
        }
        return;
      }
      if (subcommand === "health" || subcommand === "diagnose") {
        const parsed = parseMcpArgs(args);
        const id = parsed.positionals[0];
        if (!id) {
          console.error("Usage: agent mcp health <server-id> [--execution-mode trusted|full_access] [--project id] [--room id] [--timeout-ms n] [--secret-env NAME=sec_xxxxxxxx] [--json]");
          process.exitCode = 1;
          return;
        }
        const result = await createMcpHealthService(registry, platform).check({
          serverId: id,
          actor,
          mode: parsed.options.executionMode ?? "trusted",
          scope: {
            projectId: parsed.options.scopeProjectId,
            roomId: parsed.options.scopeRoomId,
          },
          timeoutMs: parsed.options.timeoutMs,
          secretEnvMap: parsed.options.secretEnvMap,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatMcpHealthResult(result));
        }
        if (result.status !== "healthy") {
          process.exitCode = 2;
        }
        return;
      }
      if (subcommand === "call-tool") {
        const parsed = parseMcpArgs(args);
        const id = parsed.positionals[0];
        const toolName = parsed.positionals[1];
        if (!id || !toolName) {
          console.error("Usage: agent mcp call-tool <server-id> <tool-name> [--input-json '{...}'|--input-file file.json] [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]");
          process.exitCode = 1;
          return;
        }
        const input = await readJsonObjectInput(parsed.options.inputJson, parsed.options.inputFile);
        const result = await createMcpExecutionService(registry, platform).execute({
          serverId: id,
          actor,
          mode: parsed.options.executionMode ?? "trusted",
          scope: {
            projectId: parsed.options.scopeProjectId,
            roomId: parsed.options.scopeRoomId,
          },
          operation: { type: "call_tool", name: toolName, input },
          timeoutMs: parsed.options.timeoutMs,
          secretEnvMap: parsed.options.secretEnvMap,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatMcpExecutionResult(result));
        }
        if (result.tool && !result.tool.ok) {
          process.exitCode = 2;
        }
        return;
      }
      if (subcommand === "read-resource") {
        const parsed = parseMcpArgs(args);
        const id = parsed.positionals[0];
        const uri = parsed.positionals[1];
        if (!id || !uri) {
          console.error("Usage: agent mcp read-resource <server-id> <uri> [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]");
          process.exitCode = 1;
          return;
        }
        const result = await createMcpExecutionService(registry, platform).execute({
          serverId: id,
          actor,
          mode: parsed.options.executionMode ?? "trusted",
          scope: {
            projectId: parsed.options.scopeProjectId,
            roomId: parsed.options.scopeRoomId,
          },
          operation: { type: "read_resource", uri },
          timeoutMs: parsed.options.timeoutMs,
          secretEnvMap: parsed.options.secretEnvMap,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatMcpExecutionResult(result));
        }
        return;
      }
      if (subcommand === "register") {
        const parsed = parseMcpArgs(args);
        const id = parsed.positionals[0];
        if (!id || !parsed.options.transport) {
          console.error("Usage: agent mcp register <server-id> --transport stdio|http [--name name] [--command cmd|--url url] [--arg value] [--env-var NAME] [--cap tools|resources|prompts|sampling] [--risk low|medium|high|critical] [--no-approval] [--disabled] [--project id] [--room id]");
          process.exitCode = 1;
          return;
        }
        const server = await registry.register({
          id,
          name: parsed.options.name,
          transport: parsed.options.transport,
          command: parsed.options.command,
          args: parsed.options.args,
          url: parsed.options.url,
          envVarNames: parsed.options.envVarNames,
          capabilities: parseMcpCapabilities(parsed.options.capabilities),
          enabled: parsed.options.enabled,
          risk: parsed.options.risk,
          requireApproval: parsed.options.requireApproval,
          allowedProjects: parsed.options.allowedProjects,
          allowedRooms: parsed.options.allowedRooms,
        });
        await platform.store.recordAuditEvent({
          id: makeId<"ArtifactId">("audit"),
          type: "mcp.server_registered",
          actor,
          summary: "MCP server registered locally",
          metadata: safeMcpAuditMetadata(server),
          artifactRefs: [],
          createdAt: new Date().toISOString(),
        });
        console.log(formatMcpServer(server));
        return;
      }
      if (subcommand === "remove" || subcommand === "delete") {
        const id = args[0];
        if (!id) {
          console.error("Usage: agent mcp remove <server-id>");
          process.exitCode = 1;
          return;
        }
        const existing = await registry.get(id);
        const removed = await registry.remove(id);
        if (removed && existing) {
          await platform.store.recordAuditEvent({
            id: makeId<"ArtifactId">("audit"),
            type: "mcp.server_removed",
            actor,
            summary: "MCP server removed locally",
            metadata: safeMcpAuditMetadata(existing),
            artifactRefs: [],
            createdAt: new Date().toISOString(),
          });
        }
        console.log(removed ? `removed\t${id}` : `not-found\t${id}`);
        return;
      }
      console.error(`Unknown mcp command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      platform.locks.close();
      platform.store.close();
    }
    return;
  }

  if (command === "rooms") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const platform = await createLocalPlatform(process.cwd());
    const { rooms, store, localAgent, locks } = platform;
    try {
      if (subcommand === "create") {
        const parsed = parseRoomArgs(args);
        const name = parsed.positionals.join(" ").trim();
        if (!name) {
          console.error("Usage: agent rooms create [--alias alias] [--agent-response broadcast|mentions_only] [--wide-mention-policy disabled|moderators|members] [--max-routed-agent-targets n] [--require-signed-invites] <name>");
          process.exitCode = 1;
          return;
        }
        const room = await rooms.createRoom({
          name,
          projectId: parsed.options.projectId,
          createdBy: localUserActor(),
          memberAliases: parsed.options.aliases,
          policy: {
            joinPolicy: parsed.options.joinPolicy ?? "manual",
            defaultCapabilities: ["room.message.send", "task.delegate", "tool.request"],
            agentResponseMode: parsed.options.agentResponseMode ?? DEFAULT_ROOM_AGENT_RESPONSE_MODE,
            wideMentionPolicy: parsed.options.wideMentionPolicy ?? DEFAULT_ROOM_WIDE_MENTION_POLICY,
            maxRoutedAgentTargets: parsed.options.maxRoutedAgentTargets,
            requireSignedInvites: parsed.options.requireSignedInvites,
            requiredApprovals: parsed.options.requiredApprovals,
            allowedFingerprints: parsed.options.allowLocalAgent
              ? [...(parsed.options.allowedFingerprints ?? []), localAgent.fingerprint]
              : parsed.options.allowedFingerprints,
            maxMembers: parsed.options.maxMembers,
            transcriptRetentionDays: parsed.options.transcriptRetentionDays,
          },
        });
        console.log(`${room.id}\t${room.name}\t${room.policy.joinPolicy}\t${room.createdAt}`);
        return;
      }

      if (subcommand === "list") {
        const parsed = parseRoomArgs(args);
        const all = await rooms.listRooms(parsed.options.limit);
        for (const room of all) {
          console.log(`${room.id}\t${room.name}\t${room.policy.joinPolicy}\t${room.createdAt}`);
        }
        return;
      }

      if (subcommand === "show") {
        const roomId = args[0];
        if (!roomId) {
          console.error("Usage: agent rooms show <room-id>");
          process.exitCode = 1;
          return;
        }
        const room = await rooms.getRoom(roomId);
        if (!room) {
          console.error(`Room not found: ${roomId}`);
          process.exitCode = 1;
          return;
        }
        const members = await rooms.listMembers(roomId);
        const messages = await rooms.listMessages(roomId, 50);
        const verifiedMessages = await Promise.all(
          messages.map(async (message) => ({
            ...message,
            signatureStatus: await rooms.verifyMessage(message),
          })),
        );
        console.log(JSON.stringify({ room, members, messages: verifiedMessages }, null, 2));
        return;
      }

      if (subcommand === "handles" || subcommand === "roster") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        if (!roomId) {
          console.error("Usage: agent rooms handles <room-id> [--json]");
          process.exitCode = 1;
          return;
        }
        const control = new ControlPlaneService(platform);
        const roster = await control.getRoomRoster(roomId);
        if (!roster) {
          console.error(`Room not found: ${roomId}`);
          process.exitCode = 1;
          return;
        }
        if (parsed.options.json) {
          console.log(JSON.stringify(roster, null, 2));
          return;
        }
        console.log(`${roster.room.id}\t${roster.room.name}\tagentResponse=${roster.room.policy.agentResponseMode ?? DEFAULT_ROOM_AGENT_RESPONSE_MODE}\twide=${roster.room.policy.wideMentionPolicy ?? DEFAULT_ROOM_WIDE_MENTION_POLICY}`);
        for (const entry of roster.entries) {
          const wake = entry.canWakeAgent ? "wakeable" : entry.wakeStatus;
          const aliases = entry.aliases.length > 0 ? entry.aliases.map((alias) => `@${alias}`).join(",") : "-";
          const stable = entry.mentionHandles.filter((handle) => handle.stable).map((handle) => handle.value).join(",");
          const agent = entry.agent ? `fingerprint=${entry.agent.fingerprint}\tmachine=${entry.agent.machineId}\ttrust=${entry.agent.trustStatus}\theartbeat=${entry.agent.heartbeatStatus ?? "-"}` : "";
          console.log(`${entry.actor.type}:${entry.actor.id}\t${entry.role}\t${entry.status}\t${wake}\tstable=${stable}\taliases=${aliases}${agent ? `\t${agent}` : ""}`);
        }
        if (roster.wideHandles.length > 0) {
          console.log(`wide\t${roster.wideHandles.map((handle) => `${handle.value}:${handle.wakesAgent ? "enabled" : "disabled"}`).join(",")}`);
        }
        return;
      }

      if (subcommand === "inbox") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        if (!roomId) {
          console.error("Usage: agent rooms inbox <room-id> [--agent-id agent-id|--local-agent] [--limit n] [--json]");
          process.exitCode = 1;
          return;
        }
        const control = new ControlPlaneService(platform);
        const inbox = await control.getRoomAgentInbox({
          roomId,
          agentId: parsed.options.agentId ?? localAgent.id,
          limit: parsed.options.limit,
          includeDelivered: parsed.options.includeDelivered,
        });
        if (!inbox) {
          console.error(`Room or agent member not found: ${roomId} / ${parsed.options.agentId ?? localAgent.id}`);
          process.exitCode = 1;
          return;
        }
        if (parsed.options.json) {
          console.log(JSON.stringify(inbox, null, 2));
          return;
        }
        console.log(`${inbox.room.id}\tagent=${inbox.member.actor.id}\tconsidered=${inbox.consideredMessages}\twakeMessages=${inbox.messages.length}`);
        for (const message of inbox.messages) {
          console.log(`${message.id}\t${message.signatureStatus}\t${message.activationContext.reason}\t${message.kind}\t${message.sender.type}:${message.sender.id}\t${message.body}`);
        }
        return;
      }

      if (subcommand === "inbox-ack") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        if (!roomId) {
          console.error("Usage: agent rooms inbox-ack <room-id> [--agent-id agent-id|--local-agent] [--message-id message-id] [--json]");
          process.exitCode = 1;
          return;
        }
        const control = new ControlPlaneService(platform);
        const cursor = await control.ackRoomAgentInbox({
          roomId,
          agentId: parsed.options.agentId ?? localAgent.id,
          messageId: parsed.options.messageId,
          actor: parsed.options.localAgent ? agentActor(localAgent) : localUserActor(),
        });
        if (!cursor) {
          console.error(`Room or agent member not found: ${roomId} / ${parsed.options.agentId ?? localAgent.id}`);
          process.exitCode = 1;
          return;
        }
        if (parsed.options.json) {
          console.log(JSON.stringify({ cursor }, null, 2));
          return;
        }
        console.log(`${cursor.roomId}\tagent=${cursor.agentId}\tlast=${cursor.lastDeliveredMessageId ?? "-"}\tupdated=${cursor.updatedAt}`);
        return;
      }

      if (subcommand === "verify") {
        const roomId = args[0];
        if (!roomId) {
          console.error("Usage: agent rooms verify <room-id>");
          process.exitCode = 1;
          return;
        }
        const messages = await rooms.listMessages(roomId, 500);
        let invalid = 0;
        for (const message of messages) {
          const status = await rooms.verifyMessage(message);
          if (status === "invalid" || status === "unknown_agent") {
            invalid += 1;
          }
          console.log(`${message.id}\t${status}\t${message.sender.type}:${message.sender.id}\t${message.kind}`);
        }
        if (invalid > 0) {
          process.exitCode = 1;
        }
        return;
      }

      if (subcommand === "invite") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        if (!roomId) {
          console.error("Usage: agent rooms invite <room-id> [--role participant|observer|executor|reviewer|approver] [--ttl-hours n] [--max-uses n]");
          process.exitCode = 1;
          return;
        }
        const actor = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const created = await rooms.createInvite({
          roomId,
          createdBy: actor,
          role: parsed.options.role ?? "participant",
          ttlHours: parsed.options.ttlHours,
          maxUses: parsed.options.maxUses,
        });
        const signatureStatus = await rooms.verifyInvite(created.invite);
        console.log(
          JSON.stringify(
            {
              inviteId: created.invite.id,
              roomId: created.invite.roomId,
              role: created.invite.role,
              status: created.invite.status,
              signatureStatus,
              maxUses: created.invite.maxUses,
              expiresAt: created.invite.expiresAt,
              token: created.token,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (subcommand === "invites") {
        const roomId = args[0];
        if (!roomId) {
          console.error("Usage: agent rooms invites <room-id>");
          process.exitCode = 1;
          return;
        }
        const invites = await rooms.listInvites(roomId);
        for (const invite of invites) {
          const signatureStatus = await rooms.verifyInvite(invite);
          console.log(`${invite.id}\t${invite.status}\t${invite.role}\tsignature=${signatureStatus}\tuses=${invite.uses}/${invite.maxUses}\texpires=${invite.expiresAt}`);
        }
        return;
      }

      if (subcommand === "revoke-invite") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        const inviteId = parsed.positionals[1];
        if (!roomId || !inviteId) {
          console.error("Usage: agent rooms revoke-invite <room-id> <invite-id> [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const revokedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const invite = await rooms.revokeInvite(roomId, inviteId, revokedBy);
        const signatureStatus = await rooms.verifyInvite(invite);
        console.log(`${invite.id}\t${invite.status}\t${invite.role}\tsignature=${signatureStatus}\tuses=${invite.uses}/${invite.maxUses}\texpires=${invite.expiresAt}`);
        return;
      }

      if (subcommand === "join") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        if (!roomId) {
          console.error("Usage: agent rooms join <room-id> [--invite-token token] [--alias alias] [--local-agent|--actor user:id|agent:id] [--role participant|observer|executor|reviewer|approver]");
          process.exitCode = 1;
          return;
        }
        const actor = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const member = parsed.options.inviteToken
          ? await rooms.joinWithInvite(roomId, parsed.options.inviteToken, actor, parsed.options.aliases)
          : await rooms.requestJoin(roomId, actor, parsed.options.role ?? "participant", parsed.options.aliases);
        console.log(`${member.roomId}\t${member.actor.type}:${member.actor.id}\t${member.role}\t${member.status}\taliases=${member.aliases?.join(",") ?? ""}`);
        return;
      }

      if (subcommand === "approve") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        const actorId = parsed.positionals[1];
        if (!roomId || !actorId) {
          console.error("Usage: agent rooms approve <room-id> <actor-id> [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const approver = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const member = await rooms.approveJoin(roomId, actorId, approver);
        console.log(`${member.roomId}\t${member.actor.type}:${member.actor.id}\t${member.role}\t${member.status}`);
        return;
      }

      if (subcommand === "alias") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        const actorId = parsed.positionals[1];
        if (!roomId || !actorId) {
          console.error("Usage: agent rooms alias <room-id> <actor-id> [--alias alias] [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const updatedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const member = await rooms.updateMemberAliases(roomId, actorId, parsed.options.aliases ?? [], updatedBy);
        console.log(`${member.roomId}\t${member.actor.type}:${member.actor.id}\taliases=${member.aliases?.join(",") ?? ""}`);
        return;
      }

      if (subcommand === "role") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        const actorId = parsed.positionals[1];
        const role = parsed.positionals[2] ? parseRoomRole(parsed.positionals[2]) : parsed.options.role;
        if (!roomId || !actorId || !role) {
          console.error("Usage: agent rooms role <room-id> <actor-id> <owner|moderator|participant|observer|executor|reviewer|approver> [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const updatedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const member = await rooms.updateMemberRole(roomId, actorId, role, updatedBy);
        console.log(`${member.roomId}\t${member.actor.type}:${member.actor.id}\trole=${member.role}\tstatus=${member.status}`);
        return;
      }

      if (subcommand === "status") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        const actorId = parsed.positionals[1];
        const status = parsed.positionals[2] ? parseRoomMemberStatus(parsed.positionals[2]) : parsed.options.status;
        if (!roomId || !actorId || !status) {
          console.error("Usage: agent rooms status <room-id> <actor-id> <invited|pending|active|suspended|left|removed|expired> [--local-agent|--actor user:id|agent:id]");
          process.exitCode = 1;
          return;
        }
        const updatedBy = parsed.options.localAgent ? agentActor(localAgent) : await resolveActor(store, parseActorRef(parsed.options.actor));
        const member = await rooms.updateMemberStatus(roomId, actorId, status, updatedBy);
        console.log(`${member.roomId}\t${member.actor.type}:${member.actor.id}\trole=${member.role}\tstatus=${member.status}`);
        return;
      }

      if (subcommand === "say") {
        const parsed = parseRoomArgs(args);
        const roomId = parsed.positionals[0];
        const body = parsed.positionals.slice(1).join(" ").trim();
        if (!roomId || !body) {
          console.error("Usage: agent rooms say <room-id> [--local-agent|--actor user:id|agent:id] [--kind chat|task|decision|tool_request|approval|artifact|system] <message with optional @alias|@agent:id|@role:role|@all>");
          process.exitCode = 1;
          return;
        }
        const sender = parsed.options.localAgent ? agentActor(localAgent) : parseActorRef(parsed.options.actor);
        const message = await rooms.sendMessage({
          roomId: roomId as Parameters<typeof rooms.sendMessage>[0]["roomId"],
          sender,
          kind: parsed.options.kind ?? "chat",
          body,
        });
        console.log(`${message.id}\t${message.roomId}\t${message.sender.type}:${message.sender.id}\t${message.kind}\t${message.body}`);
        for (const diagnostic of roomRoutingDiagnostics(message.metadata)) {
          console.log(`routing-warning\t${diagnostic.code}\t${diagnostic.raw}\t${diagnostic.message}`);
        }
        return;
      }

      console.error(`Unknown rooms command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      locks.close();
      store.close();
    }
    return;
  }

  if (command === "tool") {
    const [toolName, ...toolArgs] = rest;
    if (!toolName) {
      console.error("Missing tool name.");
      process.exitCode = 1;
      return;
    }
    const parsed = parseRunArgs(toolArgs);
    const { workspace, policy, store, locks } = await createLocalPlatform(process.cwd(), parsed.options);
    const { withPolicy } = await import("../tools/policy-tools.js");
    const { createWorkspaceTools } = await import("../tools/workspace-tools.js");
    const tools = withPolicy(createWorkspaceTools(workspace, {
      store,
      locks,
      actor: { type: "user", id: "local-user", displayName: "Local User" },
    }), {
      actor: { type: "user", id: "local-user", displayName: "Local User" },
      mode: parsed.options.executionMode ?? "trusted",
      risk: "medium",
      policy,
      store,
      scope: {
        orgId: parsed.options.orgId,
        projectId: parsed.options.projectId,
        roomId: parsed.options.roomId,
      },
      roomId: parsed.options.roomId,
    });
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      console.error(`Unknown tool: ${toolName}`);
      store.close();
      process.exitCode = 1;
      return;
    }
    const input = await parseToolInput(toolName, parsed.task, parsed.options.inputFile);
    const result = await tool.handler(input);
    console.log(JSON.stringify(result, null, 2));
    store.close();
    return;
  }

  if (command === "approvals") {
    const status = rest[0] as "pending" | "approved" | "denied" | "expired" | "cancelled" | undefined;
    const { store } = await createLocalPlatform(process.cwd());
    const approvals = await store.listApprovalRequests(status);
    for (const approval of approvals) {
      console.log(
        `${approval.id}\t${approval.status}\t${approval.action}\t${approval.createdAt}\t${approval.toolName ?? "-"}\t${approval.reason}`,
      );
    }
    store.close();
    return;
  }

  if (command === "approve" || command === "deny") {
    const parsedApproval = parseApprovalArgs(rest);
    const approvalId = parsedApproval.positionals[0];
    const reason = parsedApproval.positionals.slice(1).join(" ").trim() || undefined;
    if (!approvalId) {
      console.error("Missing approval id.");
      process.exitCode = 1;
      return;
    }
    const { agent, workspace, store, rooms, locks, localAgent, plugins, organizations, policy, secretBroker, redactor, taskBroker } = await createLocalPlatform(process.cwd());
    try {
      if (parsedApproval.options.autoResume && parsedApproval.options.queueResumeWorkerId) {
        throw new Error("--auto-resume and --queue-resume are mutually exclusive.");
      }
      const decidedBy = parsedApproval.options.localAgent
        ? agentActor(localAgent)
        : await resolveActor(store, parseActorRef(parsedApproval.options.actor));
      const existingApproval = (await store.listApprovalRequests()).find((candidate) => candidate.id === approvalId);
      if (existingApproval) {
        if (parsedApproval.options.queueResumeWorkerId && isMcpApprovalAction(existingApproval.action)) {
          throw new Error("--queue-resume is only supported for session-scoped workspace/plugin tool approvals.");
        }
        await ensureApprovalDecisionAllowed({
          approval: existingApproval,
          decidedBy,
          rooms,
          organizations,
        });
      }
      const approval = await store.decideApproval({
        approvalId,
        status: command === "approve" ? "approved" : "denied",
        decidedBy,
        decisionReason: reason,
      });
      if (!approval) {
        console.error(`Approval not found: ${approvalId}`);
        process.exitCode = 1;
        return;
      }
      await appendApprovalDecisionRoomMessage(store, approval, decidedBy);
      console.log(`${approval.id}\t${approval.status}\t${approval.action}\t${approval.decisionReason ?? ""}`);
      if (command === "approve" && (parsedApproval.options.autoReplay || parsedApproval.options.autoResume || parsedApproval.options.queueResumeWorkerId)) {
        if (isMcpApprovalAction(approval.action)) {
          if (parsedApproval.options.queueResumeWorkerId) {
            throw new Error("--queue-resume is only supported for session-scoped workspace/plugin tool approvals.");
          }
          const mcpResult = await new McpExecutionService(
            new LocalMcpRegistry(path.join(process.cwd(), ".agent")),
            new LocalMcpRuntime({ redactor }),
            policy,
            store,
            secretBroker,
          ).executeApproved({
            approvalId,
            actor: decidedBy,
          });
          console.log(JSON.stringify({ mcp: mcpResult }, null, 2));
        } else {
          const { createWorkspaceTools } = await import("../tools/workspace-tools.js");
          const { replayApprovedTool } = await import("../tools/tool-replay.js");
          const pending = await store.getPendingToolCallByApproval(approvalId);
          const pluginTools = await plugins.createTools({
            store,
            actor: decidedBy,
            sessionId: pending?.sessionId,
          });
          const replayResult = await replayApprovedTool({
            approvalId,
            store,
            actor: decidedBy,
            tools: createWorkspaceTools(workspace, {
              store,
              locks,
              actor: decidedBy,
              sessionId: pending?.sessionId,
            }).concat(pluginTools),
          });
          console.log(JSON.stringify({ replay: replayResult }, null, 2));
          if (parsedApproval.options.queueResumeWorkerId) {
            if (!pending?.sessionId) {
              throw new Error(`Approval ${approvalId} has no session to queue for resume.`);
            }
            if (!replayResult.ok) {
              throw new Error(`Approved tool replay failed; session was not queued for resume.`);
            }
            const assignment = await taskBroker.enqueue({
              actor: decidedBy,
              workerId: parsedApproval.options.queueResumeWorkerId,
              sessionId: pending.sessionId,
              metadata: {
                continuation: "approval_resume",
                approvalId,
                pendingToolCallId: pending.id,
                toolName: pending.toolName,
              },
            });
            console.log(`queued_resume\t${assignment.id}\t${assignment.workerId}\t${pending.sessionId}`);
          }
          if (parsedApproval.options.autoResume && pending?.sessionId && replayResult.ok) {
            const finalAnswer = await agent.resume(pending.sessionId);
            console.log(finalAnswer);
          }
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "replay") {
    const approvalId = rest[0];
    if (!approvalId) {
      console.error("Missing approval id.");
      process.exitCode = 1;
      return;
    }
    const { workspace, store, locks, plugins } = await createLocalPlatform(process.cwd());
    const { createWorkspaceTools } = await import("../tools/workspace-tools.js");
    const { replayApprovedTool } = await import("../tools/tool-replay.js");
    const actor = { type: "user" as const, id: "local-user", displayName: "Local User" };
    const pluginTools = await plugins.createTools({
      store,
      actor,
    });
    const result = await replayApprovedTool({
      approvalId,
      store,
      actor,
      tools: createWorkspaceTools(workspace, {
        store,
        locks,
        actor,
      }).concat(pluginTools),
    });
    console.log(JSON.stringify(result, null, 2));
    store.close();
    return;
  }

  if (command === "delegate") {
    const parsed = parseRunArgs(rest);
    if (!parsed.task) {
      console.error("Missing subtask objective.");
      process.exitCode = 1;
      return;
    }
    const { subagents, store } = await createLocalPlatform(process.cwd(), parsed.options);
    const result = await subagents.delegate({
      objective: parsed.task,
      parentSessionId: parsed.options.parentSessionId,
      roomId: parsed.options.roomId,
      assignedAgentId: parsed.options.assignedAgentId,
      createdBy: {
        type: "user",
        id: "local-user",
        displayName: "Local User",
      },
      executionMode: parsed.options.executionMode ?? "trusted",
    });
    console.log(
      JSON.stringify(
        {
          subtaskId: result.subtask.id,
          status: result.subtask.status,
          childSessionId: result.childSession?.id,
          summary: result.summary,
        },
        null,
        2,
      ),
    );
    store.close();
    return;
  }

  if (command === "subtasks") {
    const parentSessionId = rest[0];
    const { store } = await createLocalPlatform(process.cwd());
    const subtasks = await store.listSubtasks(parentSessionId);
    for (const subtask of subtasks) {
      console.log(
        `${subtask.id}\t${subtask.status}\t${subtask.createdAt}\tchild=${subtask.childSessionId ?? "-"}\tparent=${
          subtask.parentSessionId ?? "-"
        }\t${subtask.objective}`,
      );
    }
    store.close();
    return;
  }

  if (command === "skills") {
    const subcommand = rest[0] ?? "list";
    const { skills, store } = await createLocalPlatform(process.cwd());
    if (subcommand === "load") {
      const loaded = await skills.loadDirectory(`${process.cwd()}/.agent/skills`);
      for (const skill of loaded) {
        console.log(`${skill.manifest.name}@${skill.manifest.version}\t${skill.scope}\t${skill.manifest.description}`);
      }
      store.close();
      return;
    }
    if (subcommand === "show") {
      const name = rest[1];
      if (!name) {
        console.error("Missing skill name.");
        store.close();
        process.exitCode = 1;
        return;
      }
      const skill = await store.getSkill(name);
      if (!skill) {
        console.error(`Skill not found: ${name}`);
        store.close();
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(skill, null, 2));
      store.close();
      return;
    }
    const all = await store.listSkills();
    for (const skill of all) {
      console.log(`${skill.manifest.name}@${skill.manifest.version}\t${skill.scope}\t${skill.manifest.description}`);
    }
    store.close();
    return;
  }

  if (command === "memory") {
    const subcommand = rest[0];
    const { memory, store } = await createLocalPlatform(process.cwd());
    if (subcommand === "add") {
      const [scopeType, scopeId, kind, ...contentParts] = rest.slice(1);
      const content = contentParts.join(" ").trim();
      if (!scopeType || !scopeId || !kind || !content) {
        console.error("Usage: agent memory add <scope-type> <scope-id> <kind> <content>");
        store.close();
        process.exitCode = 1;
        return;
      }
      const record = await memory.add({
        scopeType: scopeType as Parameters<typeof memory.add>[0]["scopeType"],
        scopeId,
        kind: kind as Parameters<typeof memory.add>[0]["kind"],
        content,
      });
      console.log(`${record.id}\t${record.scopeType}:${record.scopeId}\t${record.kind}\t${record.summary}`);
      store.close();
      return;
    }
    if (subcommand === "delete") {
      const memoryId = rest[1];
      if (!memoryId) {
        console.error("Missing memory id.");
        store.close();
        process.exitCode = 1;
        return;
      }
      console.log((await memory.delete(memoryId)) ? "deleted" : "not found");
      store.close();
      return;
    }
    if (subcommand === "summary") {
      const sessionId = rest[1];
      const summary = rest.slice(2).join(" ").trim();
      if (!sessionId || !summary) {
        console.error("Usage: agent memory summary <session-id> <summary>");
        store.close();
        process.exitCode = 1;
        return;
      }
      const record = await memory.addSessionSummary(sessionId, summary);
      console.log(`${record.id}\t${record.sessionId}\t${record.summary}`);
      store.close();
      return;
    }
    const scopeType = rest[1];
    const scopeId = rest[2];
    const records = await memory.list(scopeType as Parameters<typeof memory.list>[0], scopeId);
    for (const record of records) {
      console.log(`${record.id}\t${record.scopeType}:${record.scopeId}\t${record.kind}\t${record.updatedAt}\t${record.summary}`);
    }
    store.close();
    return;
  }

  if (command === "spec") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { specifications, store } = await createLocalPlatform(process.cwd());
    const actor = localUserActor();
    try {
      if (subcommand === "create") {
        const parsed = parseSpecArgs(args);
        const objective = parsed.positionals.join(" ").trim();
        if (!objective) {
          console.error("Usage: agent spec create [--title title] [--org org-id] [--project project-id] [--room room-id] <objective>");
          process.exitCode = 1;
          return;
        }
        const spec = await specifications.create({
          actor,
          objective,
          title: parsed.options.title,
          orgId: parsed.options.orgId,
          projectId: parsed.options.projectId,
          roomId: parsed.options.roomId,
        });
        console.log(`${spec.id}\t${spec.status}\t${spec.projectId ?? "-"}\t${spec.title}`);
        return;
      }
      if (subcommand === "list") {
        const parsed = parseSpecArgs(args);
        const specs = await specifications.list({
          orgId: parsed.options.orgId,
          projectId: parsed.options.projectId,
          roomId: parsed.options.roomId,
          status: parsed.options.status ? parseSpecificationStatus(parsed.options.status) : undefined,
          limit: parsed.options.limit,
        });
        for (const spec of specs) {
          console.log(`${spec.id}\t${spec.status}\t${spec.updatedAt}\tproject=${spec.projectId ?? "-"}\troom=${spec.roomId ?? "-"}\t${spec.title}`);
        }
        return;
      }
      if (subcommand === "show") {
        const specId = args[0];
        if (!specId) {
          console.error("Usage: agent spec show <spec-id>");
          process.exitCode = 1;
          return;
        }
        const spec = await specifications.get(specId);
        if (!spec) {
          console.error(`Specification not found: ${specId}`);
          process.exitCode = 1;
          return;
        }
        const tasks = await specifications.listTasks(specId);
        const verifications = await specifications.listTaskVerifications({ specId, limit: 500 });
        const versions = await specifications.listVersions(specId, 50);
        const clarifications = await specifications.listClarifications({ specId, limit: 100 });
        const plans = await specifications.listPlans({ specId, limit: 50 });
        console.log(JSON.stringify({ spec, tasks, verifications, versions, clarifications, plans }, null, 2));
        return;
      }
      if (subcommand === "version") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec version <spec-id> [--reason text] [--json]");
          process.exitCode = 1;
          return;
        }
        const version = await specifications.createVersion({
          actor,
          specId,
          reason: parsed.options.reason,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(version, null, 2));
          return;
        }
        console.log(`${version.id}\tv${version.version}\ttasks=${version.taskSnapshot.length}\t${version.createdAt}\t${version.reason ?? "-"}`);
        return;
      }
      if (subcommand === "versions") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec versions <spec-id> [--limit n] [--json]");
          process.exitCode = 1;
          return;
        }
        const versions = await specifications.listVersions(specId, parsed.options.limit);
        if (parsed.options.json) {
          console.log(JSON.stringify({ specId, versions }, null, 2));
          return;
        }
        for (const version of versions) {
          console.log(`${version.id}\tv${version.version}\ttasks=${version.taskSnapshot.length}\t${version.createdAt}\t${version.reason ?? "-"}`);
        }
        return;
      }
      if (subcommand === "diff") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec diff <spec-id> [--from version-id-or-number] [--to version-id-or-number|current] [--save-artifact] [--artifact-name name] [--json]");
          process.exitCode = 1;
          return;
        }
        const diffResult = parsed.options.saveArtifact
          ? await specifications.createDiffArtifact({
              actor,
              specId,
              from: parsed.options.fromVersion,
              to: parsed.options.toVersion,
              name: parsed.options.artifactName,
            })
          : { diff: await specifications.diffVersions({
              specId,
              from: parsed.options.fromVersion,
              to: parsed.options.toVersion,
            }) };
        const { diff } = diffResult;
        if (parsed.options.json) {
          console.log(JSON.stringify(diffResult, null, 2));
          return;
        }
        console.log(
          `${diff.from} -> ${diff.to}\tspecChanges=${diff.specChanges.length}\tadded=${diff.summary.addedTasks}\tremoved=${diff.summary.removedTasks}\tchanged=${diff.summary.changedTasks}`,
        );
        if ("artifact" in diffResult) {
          console.log(`artifact\t${diffResult.artifact.id}\tsha256=${diffResult.artifact.sha256}`);
        }
        for (const change of diff.specChanges) {
          console.log(`spec.${change.field}\t${change.before}\t=>\t${change.after}`);
        }
        for (const change of diff.taskChanges) {
          console.log(`${change.change}\t${change.taskId}\tfields=${change.fields.join(",")}\t${change.title}`);
        }
        return;
      }
      if (subcommand === "plan") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec plan <spec-id> [--version version-id] [--title title] [--summary text] [--status draft|active] [--json]");
          process.exitCode = 1;
          return;
        }
        const plan = await specifications.generatePlan({
          actor,
          specId,
          versionId: parsed.options.versionId,
          title: parsed.options.title,
          summary: parsed.options.summary,
          status: parsed.options.status ? parseSpecificationPlanStatus(parsed.options.status, ["draft", "active"]) : undefined,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(plan, null, 2));
          return;
        }
        console.log(`${plan.id}\t${plan.status}\tsteps=${plan.steps.length}\topenClarifications=${plan.openClarificationIds.length}\t${plan.title}`);
        return;
      }
      if (subcommand === "plans") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec plans <spec-id> [--status draft|active|superseded|archived] [--limit n] [--json]");
          process.exitCode = 1;
          return;
        }
        const plans = await specifications.listPlans({
          specId,
          status: parsed.options.status ? parseSpecificationPlanStatus(parsed.options.status) : undefined,
          limit: parsed.options.limit,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify({ specId, plans }, null, 2));
          return;
        }
        for (const plan of plans) {
          console.log(`${plan.id}\t${plan.status}\tsteps=${plan.steps.length}\topenClarifications=${plan.openClarificationIds.length}\t${plan.createdAt}\t${plan.title}`);
        }
        return;
      }
      if (subcommand === "request-plan-approval") {
        const specId = args[0];
        const planId = args[1];
        const parsed = parseSpecArgs(args.slice(2));
        if (!specId || !planId) {
          console.error("Usage: agent spec request-plan-approval <spec-id> <plan-id> [reason]");
          process.exitCode = 1;
          return;
        }
        const approval = await specifications.requestPlanApproval({
          actor,
          specId,
          planId,
          reason: parsed.positionals.join(" ").trim() || parsed.options.reason,
        });
        console.log(`${approval.id}\t${approval.status}\t${approval.action}\t${approval.reason}`);
        return;
      }
      if (subcommand === "clarify") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        const question = parsed.positionals.join(" ").trim();
        if (!specId || !question) {
          console.error("Usage: agent spec clarify <spec-id> <question>");
          process.exitCode = 1;
          return;
        }
        const clarification = await specifications.createClarification({
          actor,
          specId,
          question,
        });
        console.log(`${clarification.id}\t${clarification.status}\t${clarification.question}`);
        return;
      }
      if (subcommand === "clarifications") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec clarifications <spec-id> [--status open|answered|resolved] [--limit n] [--json]");
          process.exitCode = 1;
          return;
        }
        const clarifications = await specifications.listClarifications({
          specId,
          status: parsed.options.status ? parseSpecificationClarificationStatus(parsed.options.status) : undefined,
          limit: parsed.options.limit,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify({ specId, clarifications }, null, 2));
          return;
        }
        for (const clarification of clarifications) {
          console.log(`${clarification.id}\t${clarification.status}\t${clarification.updatedAt}\t${clarification.question}`);
        }
        return;
      }
      if (subcommand === "answer") {
        const specId = args[0];
        const clarificationId = args[1];
        const parsed = parseSpecArgs(args.slice(2));
        const answer = parsed.positionals.join(" ").trim();
        if (!specId || !clarificationId || !answer) {
          console.error("Usage: agent spec answer <spec-id> <clarification-id> [--resolve] <answer>");
          process.exitCode = 1;
          return;
        }
        const clarification = await specifications.answerClarification({
          actor,
          specId,
          clarificationId,
          answer,
          status: parsed.options.resolve ? "resolved" : parsed.options.status ? parseAnswerClarificationStatus(parsed.options.status) : undefined,
        });
        console.log(`${clarification.id}\t${clarification.status}\t${clarification.updatedAt}\t${clarification.question}`);
        return;
      }
      if (subcommand === "task") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        const title = parsed.positionals.join(" ").trim();
        if (!specId || !title) {
          console.error("Usage: agent spec task <spec-id> [--path path] [--depends-on task-id] [--parallel] [--verify text] <title>");
          process.exitCode = 1;
          return;
        }
        const task = await specifications.addTask({
          actor,
          specId,
          title,
          description: parsed.options.description,
          parallelizable: parsed.options.parallelizable,
          paths: parsed.options.paths,
          dependsOn: parsed.options.dependsOn,
          verification: parsed.options.verification,
          order: parsed.options.order,
        });
        console.log(`${task.id}\t${task.status}\torder=${task.order}\tparallel=${task.parallelizable}\t${task.title}`);
        return;
      }
      if (subcommand === "tasks") {
        const specId = args[0];
        if (!specId) {
          console.error("Usage: agent spec tasks <spec-id>");
          process.exitCode = 1;
          return;
        }
        const tasks = await specifications.listTasks(specId);
        for (const task of tasks) {
          console.log(`${task.id}\t${task.status}\torder=${task.order}\tparallel=${task.parallelizable}\tpaths=${task.paths.join(",") || "-"}\t${task.title}`);
        }
        return;
      }
      if (subcommand === "validate") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec validate <spec-id> [--json]");
          process.exitCode = 1;
          return;
        }
        const result = await specifications.validateDag(specId);
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`${result.specId}\tvalid=${result.valid}\ttasks=${result.taskCount}\tissues=${result.issues.length}`);
        for (const issue of result.issues) {
          console.log(`${issue.type}\t${issue.taskId}\t${issue.dependencyId ?? "-"}\t${issue.message}`);
        }
        if (!result.valid) {
          process.exitCode = 1;
        }
        return;
      }
      if (subcommand === "next" || subcommand === "ready") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId) {
          console.error("Usage: agent spec next <spec-id> [--limit n] [--json]");
          process.exitCode = 1;
          return;
        }
        const tasks = await specifications.listReadyTasks({
          specId,
          limit: parsed.options.limit,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify({ specId, tasks }, null, 2));
          return;
        }
        for (const task of tasks) {
          console.log(`${task.id}\t${task.status}\torder=${task.order}\tparallel=${task.parallelizable}\tpaths=${task.paths.join(",") || "-"}\t${task.title}`);
        }
        return;
      }
      if (subcommand === "status") {
        const specId = args[0];
        const taskId = args[1];
        const status = args[2];
        if (!specId || !taskId || !status) {
          console.error("Usage: agent spec status <spec-id> <task-id> pending|in_progress|completed|blocked");
          process.exitCode = 1;
          return;
        }
        const task = await specifications.updateTaskStatus({
          actor,
          specId,
          taskId,
          status: parseSpecificationTaskStatus(status),
        });
        console.log(`${task.id}\t${task.status}\t${task.updatedAt}\t${task.title}`);
        return;
      }
      if (subcommand === "verify") {
        const specId = args[0];
        const taskId = args[1];
        const status = args[2];
        const parsed = parseSpecArgs(args.slice(3));
        const evidence = parsed.options.evidence ?? parsed.positionals.join(" ").trim();
        if (!specId || !taskId || !status || !evidence) {
          console.error("Usage: agent spec verify <spec-id> <task-id> passed|failed [--artifact artifact-id] <evidence>");
          process.exitCode = 1;
          return;
        }
        const task = await specifications.recordTaskVerification({
          actor,
          specId,
          taskId,
          status: parseSpecificationVerificationStatus(status),
          evidence,
          artifactRefs: parsed.options.artifactRefs,
        });
        console.log(`${task.id}\t${task.status}\tverification=${status}\t${task.title}`);
        return;
      }
      if (subcommand === "evidence") {
        const specId = args[0];
        const taskId = args[1];
        const parsed = parseSpecArgs(args.slice(2));
        if (!specId || !taskId || !parsed.options.provider || !parsed.options.conclusion) {
          console.error("Usage: agent spec evidence <spec-id> <task-id> --provider github|gitlab|generic --conclusion success|failure|cancelled|skipped|neutral|timed_out|action_required [--check name] [--run-id id] [--url url] [--sha sha] [--branch branch] [--external-id id]");
          process.exitCode = 1;
          return;
        }
        const task = await specifications.recordProviderEvidence({
          actor,
          specId,
          taskId,
          provider: parseSpecificationEvidenceProvider(parsed.options.provider),
          conclusion: parseSpecificationEvidenceConclusion(parsed.options.conclusion),
          checkName: parsed.options.checkName,
          runId: parsed.options.runId,
          runUrl: parsed.options.url,
          commitSha: parsed.options.sha,
          branch: parsed.options.branch,
          externalId: parsed.options.externalId,
          artifactRefs: parsed.options.artifactRefs,
        });
        console.log(`${task.id}\t${task.status}\tprovider=${parsed.options.provider}\tconclusion=${parsed.options.conclusion}\t${task.title}`);
        return;
      }
      if (subcommand === "verifications") {
        const specId = args[0];
        const taskId = args[1]?.startsWith("--") ? undefined : args[1];
        const parsed = parseSpecArgs(args.slice(taskId ? 2 : 1));
        if (!specId) {
          console.error("Usage: agent spec verifications <spec-id> [task-id] [--verification-status passed|failed] [--limit n] [--json]");
          process.exitCode = 1;
          return;
        }
        const verifications = await specifications.listTaskVerifications({
          specId,
          taskId,
          status: parsed.options.verificationStatus ? parseSpecificationVerificationStatus(parsed.options.verificationStatus) : undefined,
          limit: parsed.options.limit,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify({ specId, taskId, verifications }, null, 2));
          return;
        }
        for (const verification of verifications) {
          console.log(`${verification.id}\t${verification.taskId}\t${verification.status}\t${verification.createdAt}\tartifacts=${verification.artifactRefs.join(",") || "-"}\t${verification.evidence}`);
        }
        return;
      }
      if (subcommand === "delegate") {
        const specId = args[0];
        const taskId = args[1];
        const parsed = parseSpecArgs(args.slice(2));
        if (!specId || !taskId) {
          console.error("Usage: agent spec delegate <spec-id> <task-id> [--room room-id] [--assigned-agent agent-id] [--execution-mode trusted|balanced|strict|full_access] [--risk low|medium|high|critical]");
          process.exitCode = 1;
          return;
        }
        const result = await specifications.delegateTask({
          actor,
          specId,
          taskId,
          roomId: parsed.options.roomId,
          assignedAgentId: parsed.options.assignedAgentId,
          executionMode: parsed.options.executionMode,
          risk: parsed.options.risk,
        });
        console.log(
          JSON.stringify(
            {
              specId: result.specification.id,
              taskId: result.task.id,
              taskStatus: result.task.status,
              subtaskId: result.subtask.id,
              childSessionId: result.subtask.childSessionId,
              next: `agent assignments assign-subtask ${result.subtask.id} --worker <worker-id>`,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (subcommand === "dispatch") {
        const specId = args[0];
        const parsed = parseSpecArgs(args.slice(1));
        if (!specId || (!parsed.options.workerId && !parsed.options.autoSelectWorker)) {
          console.error("Usage: agent spec dispatch <spec-id> (--worker worker-id|--auto-select-worker) [--plan plan-id] [--require-plan-approval] [--required-plan-approvals n] [--limit n] [--max-load-ratio n] [--max-queued-per-worker n] [--ttl seconds] [--priority n] [--room room-id] [--assigned-agent agent-id]");
          process.exitCode = 1;
          return;
        }
        const results = await specifications.dispatchReadyTasks({
          actor,
          specId,
          planId: parsed.options.planId,
          requirePlanApproval: parsed.options.requirePlanApproval,
          requiredPlanApprovals: parsed.options.requiredPlanApprovals,
          workerId: parsed.options.workerId,
          autoSelectWorker: parsed.options.autoSelectWorker,
          maxDispatchLoadRatio: parsed.options.maxDispatchLoadRatio,
          maxQueuedAssignmentsPerWorker: parsed.options.maxQueuedAssignmentsPerWorker,
          limit: parsed.options.limit,
          roomId: parsed.options.roomId,
          assignedAgentId: parsed.options.assignedAgentId,
          executionMode: parsed.options.executionMode,
          risk: parsed.options.risk,
          leaseTtlSeconds: parsed.options.ttlSeconds,
          priority: parsed.options.priority,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify({ specId, dispatched: results }, null, 2));
          return;
        }
        for (const result of results) {
          console.log(
            `${result.task.id}\t${result.task.status}\tsubtask=${result.subtask.id}\tassignment=${result.assignment.id}\tworker=${result.assignment.workerId}\t${result.task.title}`,
          );
        }
        return;
      }
      console.error(`Unknown spec command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "knowledge") {
    const subcommand = rest[0] ?? "search";
    const args = rest.slice(1);
    const { knowledge, store } = await createLocalPlatform(process.cwd());
    const actor = localUserActor();
    try {
      if (subcommand === "ingest") {
        const parsed = parseKnowledgeArgs(args);
        const content = parsed.options.inputFile
          ? await readUtf8(parsed.options.inputFile)
          : parsed.positionals.join(" ").trim();
        if (!content) {
          console.error("Usage: agent knowledge ingest [--file path] [--name name] [--scope-type project] [--scope-id local] [--kind manual|file|url|repository|mcp|memory] <text>");
          process.exitCode = 1;
          return;
        }
        const result = await knowledge.ingestText({
          actor,
          scopeType: parsed.options.scopeType ?? "project",
          scopeId: parsed.options.scopeId ?? "local",
          kind: parsed.options.kind ?? (parsed.options.inputFile ? "file" : "manual"),
          name: parsed.options.name ?? parsed.options.inputFile ?? "manual knowledge",
          uri: parsed.options.uri ?? parsed.options.inputFile,
          description: parsed.options.description,
          trustLevel: parsed.options.trustLevel,
          content,
        });
        console.log(`${result.source.id}\tchunks=${result.chunks.length}\t${result.source.scopeType}:${result.source.scopeId}\t${result.source.name}`);
        return;
      }
      if (subcommand === "list") {
        const parsed = parseKnowledgeArgs(args);
        const sources = await knowledge.listSources({
          scopeType: parsed.options.scopeType,
          scopeId: parsed.options.scopeId,
          kind: parsed.options.kind,
          limit: parsed.options.limit,
        });
        for (const source of sources) {
          console.log(`${source.id}\t${source.kind}\t${source.trustLevel}\t${source.scopeType}:${source.scopeId}\t${source.updatedAt}\t${source.name}`);
        }
        return;
      }
      if (subcommand === "search") {
        const parsed = parseKnowledgeArgs(args);
        const query = parsed.positionals.join(" ").trim();
        if (!query) {
          console.error("Usage: agent knowledge search [--scope-type project] [--scope-id local] [--limit n] [--enforce-acl] [--safety off|annotate|exclude] <query>");
          process.exitCode = 1;
          return;
        }
        const results = await knowledge.search({
          query,
          scopeType: parsed.options.scopeType ?? "project",
          scopeId: parsed.options.scopeId ?? "local",
          sourceId: parsed.options.sourceId,
          limit: parsed.options.limit,
          actor,
          enforceAccess: parsed.options.enforceAccess,
          safetyMode: parsed.options.safetyMode,
        });
        for (const result of results) {
          console.log(`${result.citationId}\tsource=${result.source?.id ?? result.chunk.sourceId}\tchunk=${result.chunk.ordinal}\tscore=${result.score.toFixed(2)}\t${result.source?.name ?? "-"}`);
          if (result.safetyFindings.length > 0) {
            console.log(`safety\t${result.safetyFindings.map((finding) => `${finding.severity}:${finding.rule}`).join(",")}`);
          }
          console.log(result.snippet);
        }
        return;
      }
      if (subcommand === "eval-set") {
        const action = args[0] ?? "create";
        const parsed = parseKnowledgeArgs(args.slice(1));
        if (action !== "create") {
          console.error("Usage: agent knowledge eval-set create --file eval.json --name name");
          process.exitCode = 1;
          return;
        }
        const input = parsed.options.inputFile ? parseKnowledgeEvalFile(await readUtf8(parsed.options.inputFile)) : parseKnowledgeEvalFile(parsed.positionals.join(" ").trim());
        if (!parsed.options.name || input.cases.length === 0) {
          console.error("Usage: agent knowledge eval-set create --file eval.json --name name");
          process.exitCode = 1;
          return;
        }
        const evalSet = await knowledge.createEvalSet({
          actor,
          name: parsed.options.name,
          description: parsed.options.description,
          cases: input.cases,
          scopeType: parsed.options.scopeType ?? input.scopeType,
          scopeId: parsed.options.scopeId ?? input.scopeId,
          sourceId: parsed.options.sourceId ?? input.sourceId,
          thresholds: {
            ...input.thresholds,
            ...knowledgeThresholdOptions(parsed.options),
          },
        });
        console.log(`${evalSet.id}\tcases=${evalSet.cases.length}\t${evalSet.scopeType ?? "-"}:${evalSet.scopeId ?? "-"}\t${evalSet.name}`);
        return;
      }
      if (subcommand === "eval-sets") {
        const parsed = parseKnowledgeArgs(args);
        const evalSets = await knowledge.listEvalSets({
          scopeType: parsed.options.scopeType,
          scopeId: parsed.options.scopeId,
          sourceId: parsed.options.sourceId,
          limit: parsed.options.limit,
        });
        for (const evalSet of evalSets) {
          console.log(`${evalSet.id}\tcases=${evalSet.cases.length}\t${evalSet.scopeType ?? "-"}:${evalSet.scopeId ?? "-"}\t${evalSet.updatedAt}\t${evalSet.name}`);
        }
        return;
      }
      if (subcommand === "eval-runs") {
        const parsed = parseKnowledgeArgs(args);
        const runs = await knowledge.listEvalRuns({
          evalSetId: parsed.options.evalSetId,
          scopeType: parsed.options.scopeType,
          scopeId: parsed.options.scopeId,
          sourceId: parsed.options.sourceId,
          limit: parsed.options.limit,
        });
        for (const run of runs) {
          console.log(
            `${run.id}\tset=${run.evalSetId ?? "-"}\tgate=${run.gate.passed ? "passed" : "failed"}\trecall=${run.metrics.recallAtK.toFixed(3)}\tmrr=${run.metrics.mrr.toFixed(3)}\tcreated=${run.createdAt}`,
          );
        }
        return;
      }
      if (subcommand === "eval-trend") {
        const parsed = parseKnowledgeArgs(args);
        const trend = await knowledge.summarizeEvalTrend({
          evalSetId: parsed.options.evalSetId,
          scopeType: parsed.options.scopeType,
          scopeId: parsed.options.scopeId,
          sourceId: parsed.options.sourceId,
          limit: parsed.options.limit,
          regressionTolerance: parsed.options.regressionTolerance,
          actor,
          saveArtifact: parsed.options.saveArtifact,
          artifactName: parsed.options.artifactName,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(trend, null, 2));
          if (trend.regression.detected) {
            process.exitCode = 2;
          }
          return;
        }
        console.log(
          `runs=${trend.runCount}\tpassRate=${trend.passRate.toFixed(3)}\tpass=${trend.passCount}\tfail=${trend.failCount}\tregression=${trend.regression.detected ? "yes" : "no"}`,
        );
        if (trend.latest) {
          console.log(
            `latest\t${trend.latest.id}\trecall=${trend.latest.metrics.recallAtK.toFixed(3)}\tmrr=${trend.latest.metrics.mrr.toFixed(3)}\tempty=${trend.latest.metrics.emptyResultRate.toFixed(3)}\tcitation_precision=${trend.latest.metrics.citationPrecision.toFixed(3)}\tpermission_leak_rate=${trend.latest.metrics.permissionLeakRate.toFixed(3)}\tpermission_leak_count=${trend.latest.metrics.permissionLeakCount}\tgate=${trend.latest.gate.passed ? "passed" : "failed"}`,
          );
        }
        if (trend.deltas) {
          console.log(
            `delta\trecall=${trend.deltas.recallAtK.toFixed(3)}\tmrr=${trend.deltas.mrr.toFixed(3)}\tempty=${trend.deltas.emptyResultRate.toFixed(3)}\tcitation_precision=${trend.deltas.citationPrecision.toFixed(3)}\tpermission_leak_rate=${trend.deltas.permissionLeakRate.toFixed(3)}\tpermission_leak_count=${trend.deltas.permissionLeakCount}`,
          );
        }
        for (const reason of trend.regression.reasons) {
          console.log(`regression_reason\t${reason}`);
        }
        if (trend.artifact) {
          console.log(`artifact\t${trend.artifact.id}\tsha256=${trend.artifact.sha256}`);
        }
        if (trend.regression.detected) {
          process.exitCode = 2;
        }
        return;
      }
      if (subcommand === "eval") {
        const parsed = parseKnowledgeArgs(args);
        const input = parsed.options.inputFile || parsed.positionals.length > 0
          ? parseKnowledgeEvalFile(parsed.options.inputFile ? await readUtf8(parsed.options.inputFile) : parsed.positionals.join(" ").trim())
          : { cases: [] };
        if (input.cases.length === 0 && !parsed.options.evalSetId) {
          console.error("Usage: agent knowledge eval --file eval.json|--eval-set id [--scope-type project] [--scope-id local] [--limit n] [--min-recall n] [--min-mrr n] [--max-empty-rate n] [--min-citation-precision n] [--max-permission-leak-rate n] [--enforce-acl] [--safety off|annotate|exclude] [--save-run] [--save-artifact] [--artifact-name name] [--json]");
          process.exitCode = 1;
          return;
        }
        const result = await knowledge.evaluate({
          actor,
          cases: input.cases.length > 0 ? input.cases : undefined,
          evalSetId: parsed.options.evalSetId,
          scopeType: parsed.options.scopeType ?? input.scopeType,
          scopeId: parsed.options.scopeId ?? input.scopeId,
          sourceId: parsed.options.sourceId ?? input.sourceId,
          limit: parsed.options.limit ?? input.limit,
          thresholds: {
            ...input.thresholds,
            ...knowledgeThresholdOptions(parsed.options),
          },
          saveArtifact: parsed.options.saveArtifact,
          artifactName: parsed.options.artifactName,
          enforceAccess: parsed.options.enforceAccess ?? input.enforceAccess,
          safetyMode: parsed.options.safetyMode ?? input.safetyMode,
          saveRun: parsed.options.saveRun,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.gate.passed) {
            process.exitCode = 2;
          }
          return;
        }
        console.log(
          `cases=${result.caseCount}\tlimit=${result.limit}\trecall@${result.limit}=${result.metrics.recallAtK.toFixed(3)}\tmrr=${result.metrics.mrr.toFixed(3)}\tempty=${result.metrics.emptyResultRate.toFixed(3)}\tcitation_precision=${result.metrics.citationPrecision.toFixed(3)}\tpermission_leak_rate=${result.metrics.permissionLeakRate.toFixed(3)}\tpermission_leak_count=${result.metrics.permissionLeakCount}\tgate=${result.gate.passed ? "passed" : "failed"}`,
        );
        for (const failure of result.gate.failures) {
          console.log(`gate_failure\t${failure}`);
        }
        if (result.artifact) {
          console.log(`artifact\t${result.artifact.id}\tsha256=${result.artifact.sha256}`);
        }
        if (result.run) {
          console.log(`run\t${result.run.id}\tset=${result.run.evalSetId ?? "-"}`);
        }
        for (const item of result.cases) {
          console.log(`${item.id}\thit=${item.hitRank ?? "-"}\trr=${item.reciprocalRank.toFixed(3)}\tcitation_precision=${item.citationPrecision.toFixed(3)}\tpermission_leaks=${item.permissionLeakCount}\t${item.query}`);
        }
        if (!result.gate.passed) {
          process.exitCode = 2;
        }
        return;
      }
      console.error(`Unknown knowledge command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "plugins") {
    const subcommand = rest[0] ?? "list";

    if (subcommand === "run") {
      const toolName = rest[1];
      if (!toolName) {
        console.error("Usage: agent plugins run <plugin.tool.name> [--execution-mode strict|balanced|trusted|full_access] [--room room-id] [--input-file file] [json-input]");
        process.exitCode = 1;
        return;
      }
      const parsed = parseRunArgs(rest.slice(2));
      const { plugins, policy, store } = await createLocalPlatform(process.cwd(), parsed.options);
      const actor = { type: "user" as const, id: "local-user", displayName: "Local User" };
      try {
        const { withPolicy } = await import("../tools/policy-tools.js");
        const tools = withPolicy(await plugins.createTools({
          store,
          actor,
          roomId: parsed.options.roomId,
        }), {
          actor,
          mode: parsed.options.executionMode ?? "trusted",
          risk: "medium",
          policy,
          store,
          scope: {
            orgId: parsed.options.orgId,
            projectId: parsed.options.projectId,
            roomId: parsed.options.roomId,
          },
          roomId: parsed.options.roomId,
        });
        const tool = tools.find((candidate) => candidate.name === toolName);
        if (!tool) {
          console.error(`Unknown plugin tool: ${toolName}`);
          process.exitCode = 1;
          return;
        }
        const result = await tool.handler(await parsePluginInput(parsed.task, parsed.options.inputFile));
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        store.close();
      }
      return;
    }

    const { plugins, store } = await createLocalPlatform(process.cwd());
    try {
      const loaded = await plugins.listPlugins();
      if (subcommand === "list") {
        const { pluginToolName } = await import("../plugins/local-plugin-loader.js");
        for (const plugin of loaded) {
          for (const pluginCommand of plugin.manifest.commands ?? []) {
            console.log(
              `${pluginToolName(plugin.manifest.name, pluginCommand.name)}\t${plugin.manifest.version}\t${
                pluginCommand.risk ?? "auto"
              }\t${(plugin.manifest.permissions ?? []).join(",")}`,
            );
          }
        }
        return;
      }
      if (subcommand === "show") {
        const name = rest[1];
        if (!name) {
          console.error("Usage: agent plugins show <plugin-name|plugin.tool.name>");
          process.exitCode = 1;
          return;
        }
        const { pluginToolName } = await import("../plugins/local-plugin-loader.js");
        const plugin = loaded.find((candidate) => {
          if (candidate.manifest.name === name) {
            return true;
          }
          return (candidate.manifest.commands ?? []).some((pluginCommand) => pluginToolName(candidate.manifest.name, pluginCommand.name) === name);
        });
        if (!plugin) {
          console.error(`Plugin not found: ${name}`);
          process.exitCode = 1;
          return;
        }
        console.log(
          JSON.stringify(
            {
              ...plugin,
              tools: (plugin.manifest.commands ?? []).map((pluginCommand) => pluginToolName(plugin.manifest.name, pluginCommand.name)),
            },
            null,
            2,
          ),
        );
        return;
      }
      console.error(`Unknown plugins command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "changes") {
    const sessionId = rest[0];
    const { store } = await createLocalPlatform(process.cwd());
    const changes = await store.listFileChanges(sessionId);
    for (const change of changes) {
      console.log(`${change.id}\t${change.kind}\t${change.createdAt}\t${change.path}\t${change.summary}`);
    }
    store.close();
    return;
  }

  if (command === "artifacts") {
    const subcommand = rest[0] ?? "list";
    const args = rest.slice(1);
    const { lifecycle, store } = await createLocalPlatform(process.cwd());
    const actor = localUserActor();
    try {
      if (subcommand === "add") {
        const parsed = parseArtifactArgs(args);
        const artifactPath = parsed.positionals[0];
        if (!artifactPath && !parsed.options.uri) {
          console.error("Usage: agent artifacts add <path> [--kind kind] [--name name] [--project id] [--session id] [--room id] [--uri uri]");
          process.exitCode = 1;
          return;
        }
        const artifact = await lifecycle.registerArtifact({
          kind: parsed.options.kind ?? "other",
          name: parsed.options.name,
          path: artifactPath,
          uri: parsed.options.uri,
          mimeType: parsed.options.mimeType,
          orgId: parsed.options.orgId,
          projectId: parsed.options.projectId,
          sessionId: parsed.options.sessionId,
          roomId: parsed.options.roomId,
          actor,
        });
        console.log(`${artifact.id}\t${artifact.kind}\t${artifact.status}\t${artifact.sizeBytes ?? "-"}\t${artifact.name}`);
        return;
      }
      if (subcommand === "list") {
        const parsed = parseArtifactArgs(args);
        const artifacts = await store.listArtifacts({
          status: parsed.options.status,
          projectId: parsed.options.projectId,
          sessionId: parsed.options.sessionId,
          roomId: parsed.options.roomId,
          kind: parsed.options.kind,
          limit: parsed.options.limit,
        });
        for (const artifact of artifacts) {
          console.log(
            `${artifact.id}\t${artifact.status}\t${artifact.kind}\t${artifact.createdAt}\t${artifact.projectId ?? "-"}\t${artifact.sessionId ?? "-"}\t${artifact.name}`,
          );
        }
        return;
      }
      if (subcommand === "delete") {
        const artifactId = args[0];
        const parsed = parseArtifactArgs(args.slice(1));
        if (!artifactId) {
          console.error("Usage: agent artifacts delete <artifact-id> [--delete-file] [--force]");
          process.exitCode = 1;
          return;
        }
        const artifact = await lifecycle.deleteArtifact({
          artifactId,
          actor,
          deleteFile: parsed.options.deleteFile,
          force: parsed.options.force,
        });
        console.log(`${artifact.id}\t${artifact.status}\tdeleted_at=${artifact.deletedAt ?? "-"}`);
        return;
      }
      console.error(`Unknown artifacts command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "session") {
    const subcommand = rest[0];
    const sessionId = rest[1];
    const args = rest.slice(2);
    const { lifecycle, store } = await createLocalPlatform(process.cwd());
    const actor = localUserActor();
    try {
      if (subcommand === "diff") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session diff <session-id> [--json]");
          process.exitCode = 1;
          return;
        }
        const diff = await buildSessionDiff(store, sessionId);
        if (parsed.options.json) {
          console.log(JSON.stringify(diff, null, 2));
        } else {
          printSessionDiff(diff);
        }
        return;
      }
      if (subcommand === "report") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session report <session-id> [--json]");
          process.exitCode = 1;
          return;
        }
        const report = await buildSessionReport(store, sessionId);
        if (parsed.options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printSessionReport(report);
        }
        return;
      }
      if (subcommand === "status") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session status <session-id> [--json]");
          process.exitCode = 1;
          return;
        }
        const status = await buildSessionStatus(store, sessionId, { limit: parsed.options.limit });
        if (parsed.options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          printSessionStatus(status);
        }
        return;
      }
      if (subcommand === "timeline" || subcommand === "logs") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session timeline <session-id> [--json] [--limit n]");
          process.exitCode = 1;
          return;
        }
        const timeline = await buildSessionTimeline(store, sessionId, { limit: parsed.options.limit });
        if (parsed.options.json) {
          console.log(JSON.stringify(timeline, null, 2));
        } else {
          printSessionTimeline(timeline);
        }
        return;
      }
      if (subcommand === "review") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session review <session-id> [--json] [--limit n]");
          process.exitCode = 1;
          return;
        }
        const review = await buildSessionReview(store, sessionId, { limit: parsed.options.limit });
        if (parsed.options.json) {
          console.log(JSON.stringify(review, null, 2));
        } else {
          printSessionReview(review);
        }
        return;
      }
      if (subcommand === "bundle") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session bundle <session-id> [--json] [--output path] [--limit n] [verification options]");
          process.exitCode = 1;
          return;
        }
        const bundle = await buildSessionEvidenceBundle(store, sessionId, {
          limit: parsed.options.limit,
          requireChange: parsed.options.requireChange,
          requirePatch: parsed.options.requirePatch,
          requireRecovery: parsed.options.requireRecovery,
          requireTimeout: parsed.options.requireTimeout,
          requireDiffStat: parsed.options.requireDiffStat,
          requiredExecutionProfiles: parsed.options.requiredExecutionProfiles,
          requiredApprovalActions: parsed.options.requiredApprovalActions,
          requireCommand: parsed.options.allowNoCommand !== true,
        });
        const output = parsed.options.output ? await writeJsonOutputInsideWorkspace(process.cwd(), parsed.options.output, bundle) : undefined;
        const printable = output ? { ...bundle, output } : bundle;
        if (parsed.options.json) {
          console.log(JSON.stringify(printable, null, 2));
        } else {
          printSessionEvidenceBundle(printable);
        }
        return;
      }
      if (subcommand === "result") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session result <session-id> [--json]");
          process.exitCode = 1;
          return;
        }
        const result = await buildSessionResult(store, sessionId);
        if (parsed.options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printSessionResult(result);
        }
        return;
      }
      if (subcommand === "verify") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session verify <session-id> [--json] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-execution-profile profile] [--require-approval-action action] [--allow-no-command]");
          process.exitCode = 1;
          return;
        }
        const verification = await buildSessionVerification(store, sessionId, {
          requireChange: parsed.options.requireChange,
          requirePatch: parsed.options.requirePatch,
          requireRecovery: parsed.options.requireRecovery,
          requireTimeout: parsed.options.requireTimeout,
          requireDiffStat: parsed.options.requireDiffStat,
          requiredExecutionProfiles: parsed.options.requiredExecutionProfiles,
          requiredApprovalActions: parsed.options.requiredApprovalActions,
          requireCommand: parsed.options.allowNoCommand !== true,
        });
        if (parsed.options.json) {
          console.log(JSON.stringify(verification, null, 2));
        } else {
          printSessionVerification(verification);
        }
        if (verification.status !== "pass") {
          process.exitCode = 1;
        }
        return;
      }
      if (subcommand === "compact") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session compact <session-id> [--summary text] [--force]");
          process.exitCode = 1;
          return;
        }
        const result = await lifecycle.compactSession({
          sessionId,
          actor,
          summary: parsed.options.summary,
          force: parsed.options.force,
        });
        console.log(`${result.sessionId}\tmessages_deleted=${result.messagesDeleted}\ttool_calls_deleted=${result.toolCallsDeleted}`);
        return;
      }
      if (subcommand === "delete") {
        const parsed = parseLifecycleArgs(args);
        if (!sessionId) {
          console.error("Usage: agent session delete <session-id> [--force]");
          process.exitCode = 1;
          return;
        }
        await lifecycle.deleteSession({ sessionId, actor, force: parsed.options.force });
        console.log(`${sessionId}\tdeleted`);
        return;
      }
      console.error("Usage: agent session diff|report|status|timeline|logs|review|result|verify|compact|delete <session-id>");
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "audit") {
    const subcommand = rest[0] ?? "list";
    const parsed = parseAuditArgs(rest.slice(1));
    const { store, identity } = await createLocalPlatform(process.cwd());
    try {
      if (subcommand === "list") {
        const events = await store.listAuditEvents(parsed.filters);
        for (const event of events) {
          console.log(
            `${event.createdAt}\t${event.type}\t${event.actor.type}:${event.actor.id}\t${event.sessionId ?? "-"}\t${event.roomId ?? "-"}\t${event.summary}`,
          );
        }
        return;
      }
      if (subcommand === "export") {
        await ensureAuditExportAllowed(store, parsed.filters);
        const { AuditExportService } = await import("../audit/audit-export-service.js");
        const exported = await new AuditExportService({ store, identity }).export({
          filters: parsed.filters,
          format: parsed.options.format,
        });
        if (parsed.options.output) {
          const { promises: fs } = await import("node:fs");
          const path = await import("node:path");
          await fs.mkdir(path.dirname(parsed.options.output), { recursive: true });
          await fs.writeFile(parsed.options.output, exported.output, "utf8");
          const signatureStatus = exported.bundle?.signature ? "signed" : "unsigned";
          console.log(`${exported.count}\t${parsed.options.format}\t${signatureStatus}\t${parsed.options.output}`);
        } else {
          process.stdout.write(exported.output);
        }
        return;
      }
      if (subcommand === "verify") {
        const filePath = rest[1];
        if (!filePath) {
          console.error("Usage: agent audit verify <bundle-path>");
          process.exitCode = 1;
          return;
        }
        const { AuditExportService } = await import("../audit/audit-export-service.js");
        const bundle = JSON.parse(await readUtf8(filePath)) as AuditExportBundle;
        const status = await new AuditExportService({ store, identity }).verifyBundle(bundle);
        console.log(`${status}\t${bundle.exportId ?? "-"}\tcount=${bundle.eventCount ?? "-"}\tsha256=${bundle.eventsSha256 ?? "-"}`);
        if (status !== "valid") {
          process.exitCode = 2;
        }
        return;
      }
      console.error(`Unknown audit command: ${subcommand}`);
      process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  if (command === "web") {
    const options = parseWebArgs(rest);
    const { startLocalRoomWebServer } = await import("../web/local-room-web-server.js");
    try {
      const server = await startLocalRoomWebServer(process.cwd(), options);
      console.log(`Room Web UI: ${server.url}`);
      process.on("SIGINT", () => {
        server.close();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        server.close();
        process.exit(0);
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "phase1") {
    const subcommand = rest[0] ?? "verify";
    if (subcommand !== "verify" && subcommand !== "check") {
      console.error("Usage: agent phase1 verify [--json]");
      process.exitCode = 1;
      return;
    }
    try {
      const result = await verifyPhaseOneReadiness(process.cwd());
      if (rest.slice(1).includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printPhaseOneReadiness(result);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "phase2") {
    const subcommand = rest[0] ?? "verify";
    if (subcommand !== "verify" && subcommand !== "smoke") {
      console.error("Usage: agent phase2 verify [--workspace path] [--json] [--cleanup]");
      process.exitCode = 1;
      return;
    }
    try {
      const args = rest.slice(1);
      const workspace = await resolveInitialWorkspace(process.cwd(), args);
      const cleanArgs = stripWorkspaceOption(args);
      const result = await verifyPhaseTwoEngineeringSmoke(workspace, {
        cleanup: cleanArgs.includes("--cleanup"),
      });
      if (cleanArgs.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printPhaseTwoEngineeringSmoke(result);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "hygiene") {
    const subcommand = rest[0] ?? "check";
    if (subcommand !== "check") {
      console.error(`Unknown hygiene command: ${subcommand}`);
      process.exitCode = 1;
      return;
    }
    const json = rest.includes("--json");
    const findings = await scanExecutionHygiene(process.cwd());
    if (json) {
      console.log(JSON.stringify({ findings, count: findings.length }, null, 2));
    } else if (findings.length === 0) {
      console.log("Workspace hygiene check passed.");
    } else {
      for (const finding of findings) {
        console.log(`${finding.severity}\t${finding.rule}\t${finding.path}\t${finding.message}`);
      }
    }
    process.exitCode = findings.some((finding) => finding.severity === "error") ? 1 : 0;
    return;
  }

  const targetModeCommand = isTargetModeCommand(command) ? parseTargetMode(command) : undefined;
  if (command !== "run" && command !== "ask" && !targetModeCommand) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const workspace = await resolveInitialWorkspace(process.cwd(), rest);
  const runArgs = stripWorkspaceOption(rest);
  const parsed = parseRunArgs(runArgs);
  if (targetModeCommand) {
    parsed.options.targetMode = targetModeCommand;
  }
  const task = parsed.task;
  if (!task) {
    console.error("Missing task.");
    printHelp();
    process.exitCode = 1;
    return;
  }
  parsed.options.knowledgeQuery = task;

  const { agent, store } = await createLocalPlatform(workspace, parsed.options);

  const runResult = await agent.runWithSession(task);
  const completedSession = runResult.session ? (await store.getSession(runResult.session.id)) ?? runResult.session : undefined;
  let sessionResult: Awaited<ReturnType<typeof buildSessionResult>> | undefined;
  let verification: Awaited<ReturnType<typeof buildSessionVerification>> | undefined;
  if (completedSession && (parsed.cli.json || parsed.cli.sessionResult || parsed.cli.verifySession)) {
    sessionResult = await buildSessionResult(store, completedSession.id);
  }
  if (completedSession && parsed.cli.verifySession) {
    verification = await buildSessionVerification(store, completedSession.id, {
      requireChange: parsed.cli.requireChange,
      requirePatch: parsed.cli.requirePatch,
      requireRecovery: parsed.cli.requireRecovery,
      requireTimeout: parsed.cli.requireTimeout,
      requireDiffStat: parsed.cli.requireDiffStat,
      requiredExecutionProfiles: parsed.cli.requiredExecutionProfiles,
      requiredApprovalActions: parsed.cli.requiredApprovalActions,
      requireCommand: parsed.cli.allowNoCommand !== true,
    });
  }
  if (parsed.cli.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      workspace,
      session: completedSession,
      finalAnswer: runResult.finalAnswer,
      result: sessionResult,
      verification,
      reviewCommands: completedSession
        ? {
            review: `agent session review ${completedSession.id}`,
            result: `agent session result ${completedSession.id}`,
            verify: `agent session verify ${completedSession.id}`,
            diff: `agent session diff ${completedSession.id}`,
            report: `agent session report ${completedSession.id} --json`,
          }
        : undefined,
    }, null, 2));
  } else {
    console.log(runResult.finalAnswer);
    if (completedSession) {
      console.log("");
      console.log(`session: ${completedSession.id}`);
      console.log(`review: agent session review ${completedSession.id}`);
    }
    if (sessionResult && parsed.cli.sessionResult) {
      console.log("");
      printSessionResult(sessionResult);
    }
    if (verification) {
      console.log("");
      printSessionVerification(verification);
    }
  }
  if (verification?.status === "fail") {
    process.exitCode = 1;
  }
  store.close();
}

type RunCliOptions = {
  json?: boolean;
  sessionResult?: boolean;
  verifySession?: boolean;
  requireChange?: boolean;
  requirePatch?: boolean;
  requireRecovery?: boolean;
  requireTimeout?: boolean;
  requireDiffStat?: boolean;
  requiredExecutionProfiles?: CommandExecutionProfileName[];
  requiredApprovalActions?: PolicyAction[];
  allowNoCommand?: boolean;
};

function parseRunArgs(args: string[]) {
  const options: Parameters<typeof createLocalPlatform>[1] = {};
  const cli: RunCliOptions = {};
  const taskParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === "--require-execution-profile" || arg === "--require-execution-profiles") && next) {
      cli.requiredExecutionProfiles = [...(cli.requiredExecutionProfiles ?? []), ...parseCommandExecutionProfileList(next)];
      cli.verifySession = true;
      index += 1;
      continue;
    }
    if ((arg === "--require-approval-action" || arg === "--require-approval-actions") && next) {
      cli.requiredApprovalActions = [...(cli.requiredApprovalActions ?? []), ...parsePolicyActionList(next)];
      cli.verifySession = true;
      index += 1;
      continue;
    }
    if (applyRunEvidenceFlag(arg, cli)) {
      continue;
    }
    if (arg === "--provider" && next) {
      options.provider = next as NonNullable<typeof options.provider>;
      index += 1;
      continue;
    }
    if (arg === "--model" && next) {
      options.model = next;
      index += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--api-key-env" && next) {
      options.apiKeyEnv = next;
      index += 1;
      continue;
    }
    if (arg === "--api-key-secret" && next) {
      options.apiKeySecretRef = next;
      index += 1;
      continue;
    }
    if (arg === "--fallback-provider" && next) {
      options.fallbackProviders ??= [];
      options.fallbackProviders.push(next as NonNullable<typeof options.provider>);
      index += 1;
      continue;
    }
    if (arg === "--model-retries" && next) {
      options.modelMaxRetries = parseNonNegativeInteger(next, "--model-retries");
      index += 1;
      continue;
    }
    if (arg === "--model-retry-base-ms" && next) {
      options.modelRetryBaseDelayMs = parseNonNegativeInteger(next, "--model-retry-base-ms");
      index += 1;
      continue;
    }
    if (arg === "--model-retry-max-ms" && next) {
      options.modelRetryMaxDelayMs = parseNonNegativeInteger(next, "--model-retry-max-ms");
      index += 1;
      continue;
    }
    if (arg === "--model-call-budget" && next) {
      options.modelMaxCalls = parseNonNegativeInteger(next, "--model-call-budget");
      index += 1;
      continue;
    }
    if (arg === "--model-failure-budget" && next) {
      options.modelMaxFailures = parseNonNegativeInteger(next, "--model-failure-budget");
      index += 1;
      continue;
    }
    if (arg === "--model-circuit-break-after" && next) {
      options.modelCircuitBreakAfterFailures = parseNonNegativeInteger(next, "--model-circuit-break-after");
      index += 1;
      continue;
    }
    if (arg === "--model-circuit-open-ms" && next) {
      options.modelCircuitOpenMs = parseNonNegativeInteger(next, "--model-circuit-open-ms");
      index += 1;
      continue;
    }
    if (arg === "--execution-mode" && next) {
      options.executionMode = next as NonNullable<typeof options.executionMode>;
      index += 1;
      continue;
    }
    if ((arg === "--target-mode" || arg === "--mode") && next) {
      options.targetMode = parseTargetMode(next);
      index += 1;
      continue;
    }
    if (arg === "--parent-session" && next) {
      options.parentSessionId = next;
      index += 1;
      continue;
    }
    if (arg === "--org" && next) {
      options.orgId = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      options.roomId = next;
      index += 1;
      continue;
    }
    if (arg === "--spec" && next) {
      options.specId = next;
      index += 1;
      continue;
    }
    if (arg === "--assigned-agent" && next) {
      options.assignedAgentId = next;
      index += 1;
      continue;
    }
    if (arg === "--skill" && next) {
      options.skills = [...(options.skills ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--memory-scope" && next) {
      options.memoryScopeType = next as NonNullable<typeof options.memoryScopeType>;
      index += 1;
      continue;
    }
    if (arg === "--memory-id" && next) {
      options.memoryScopeId = next;
      index += 1;
      continue;
    }
    if (arg === "--knowledge-scope" && next) {
      options.knowledgeScopeType = next as NonNullable<typeof options.knowledgeScopeType>;
      index += 1;
      continue;
    }
    if (arg === "--knowledge-id" && next) {
      options.knowledgeScopeId = next;
      index += 1;
      continue;
    }
    if (arg === "--knowledge-enforce-acl" || arg === "--enforce-knowledge-acl") {
      options.knowledgeEnforceAccess = true;
      continue;
    }
    if (arg === "--knowledge-safety" && next) {
      options.knowledgeSafetyMode = parseKnowledgeSafetyMode(next);
      index += 1;
      continue;
    }
    if (arg === "--no-workspace-snapshot") {
      options.workspaceSnapshot = false;
      continue;
    }
    if (arg === "--include-key-files") {
      options.workspaceKeyFilePreviews = true;
      continue;
    }
    if (arg === "--max-key-files" && next) {
      options.workspaceKeyFilePreviews = true;
      options.workspaceMaxKeyFiles = parsePositiveInteger(next, "--max-key-files");
      index += 1;
      continue;
    }
    if (arg === "--max-preview-lines" && next) {
      options.workspaceKeyFilePreviews = true;
      options.workspaceMaxPreviewLines = parsePositiveInteger(next, "--max-preview-lines");
      index += 1;
      continue;
    }
    if (arg === "--max-preview-chars" && next) {
      options.workspaceKeyFilePreviews = true;
      options.workspaceMaxPreviewChars = parsePositiveInteger(next, "--max-preview-chars");
      index += 1;
      continue;
    }
    if (arg === "--input-file" && next) {
      options.inputFile = next;
      index += 1;
      continue;
    }
    taskParts.push(arg);
  }

  return {
    options,
    cli,
    task: taskParts.join(" ").trim(),
  };
}

function parseRunEvidenceArgs(args: string[]): RunCliOptions {
  const cli: RunCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === "--require-execution-profile" || arg === "--require-execution-profiles") && next) {
      cli.requiredExecutionProfiles = [...(cli.requiredExecutionProfiles ?? []), ...parseCommandExecutionProfileList(next)];
      cli.verifySession = true;
      index += 1;
      continue;
    }
    if ((arg === "--require-approval-action" || arg === "--require-approval-actions") && next) {
      cli.requiredApprovalActions = [...(cli.requiredApprovalActions ?? []), ...parsePolicyActionList(next)];
      cli.verifySession = true;
      index += 1;
      continue;
    }
    if (applyRunEvidenceFlag(arg, cli)) {
      continue;
    }
    throw new Error(`Unknown resume option: ${arg}`);
  }
  return cli;
}

function applyRunEvidenceFlag(arg: string, cli: RunCliOptions): boolean {
  const executionProfilesValue = inlineOptionValue(arg, "--require-execution-profiles") ?? inlineOptionValue(arg, "--require-execution-profile");
  if (executionProfilesValue !== undefined) {
    cli.requiredExecutionProfiles = [...(cli.requiredExecutionProfiles ?? []), ...parseCommandExecutionProfileList(executionProfilesValue)];
    cli.verifySession = true;
    return true;
  }
  const approvalActionsValue = inlineOptionValue(arg, "--require-approval-actions") ?? inlineOptionValue(arg, "--require-approval-action");
  if (approvalActionsValue !== undefined) {
    cli.requiredApprovalActions = [...(cli.requiredApprovalActions ?? []), ...parsePolicyActionList(approvalActionsValue)];
    cli.verifySession = true;
    return true;
  }
  if (arg === "--json") {
    cli.json = true;
    return true;
  }
  if (arg === "--session-result" || arg === "--result") {
    cli.sessionResult = true;
    return true;
  }
  if (arg === "--verify-session" || arg === "--verify") {
    cli.verifySession = true;
    return true;
  }
  if (arg === "--require-change") {
    cli.requireChange = true;
    cli.verifySession = true;
    return true;
  }
  if (arg === "--require-patch") {
    cli.requirePatch = true;
    cli.verifySession = true;
    return true;
  }
  if (arg === "--require-recovery") {
    cli.requireRecovery = true;
    cli.verifySession = true;
    return true;
  }
  if (arg === "--require-timeout") {
    cli.requireTimeout = true;
    cli.verifySession = true;
    return true;
  }
  if (arg === "--require-diff-stat" || arg === "--require-diff-stats") {
    cli.requireDiffStat = true;
    cli.verifySession = true;
    return true;
  }
  if (arg === "--allow-no-command") {
    cli.allowNoCommand = true;
    return true;
  }
  return false;
}

const POLICY_ACTION_VALUES = [
  "workspace.read",
  "workspace.write",
  "shell.run.safe",
  "shell.run.high_risk",
  "dependency.install",
  "git.mutation",
  "git.branch.create",
  "git.commit.create",
  "git.push",
  "git.pr.create",
  "secret.read",
  "plugin.execute",
  "mcp.connect",
  "mcp.tool.call",
  "mcp.resource.read",
  "knowledge.read",
  "room.message.send",
  "room.member.approve",
  "room.member.alias",
  "room.member.role",
  "room.member.status",
  "room.delivery.ack",
  "tool.approve",
  "spec.plan.approve",
] as const satisfies readonly PolicyAction[];

const POLICY_ACTION_SET = new Set<string>(POLICY_ACTION_VALUES);
const COMMAND_EXECUTION_PROFILE_SET = new Set<string>(COMMAND_EXECUTION_PROFILE_NAMES);

function inlineOptionValue(arg: string, name: string): string | undefined {
  return arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : undefined;
}

function parsePolicyActionList(value: string): PolicyAction[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parsePolicyAction);
}

function parsePolicyAction(value: string): PolicyAction {
  if (POLICY_ACTION_SET.has(value)) {
    return value as PolicyAction;
  }
  throw new Error(`Unknown policy action: ${value}.`);
}

function parseCommandExecutionProfileList(value: string): CommandExecutionProfileName[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseCommandExecutionProfileName);
}

function parseCommandExecutionProfileName(value: string): CommandExecutionProfileName {
  if (COMMAND_EXECUTION_PROFILE_SET.has(value)) {
    return value as CommandExecutionProfileName;
  }
  throw new Error(`Unknown command execution profile: ${value}. Expected one of ${COMMAND_EXECUTION_PROFILE_NAMES.join(", ")}.`);
}

function parseInspectArgs(args: string[]): { json: boolean; includeKeyFiles: boolean; maxKeyFiles?: number; maxPreviewLines?: number; maxPreviewChars?: number } {
  const options = { json: false, includeKeyFiles: false } as {
    json: boolean;
    includeKeyFiles: boolean;
    maxKeyFiles?: number;
    maxPreviewLines?: number;
    maxPreviewChars?: number;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-key-files") {
      options.includeKeyFiles = true;
      continue;
    }
    if (arg === "--max-key-files" && next) {
      options.maxKeyFiles = parsePositiveInteger(next, "--max-key-files");
      index += 1;
      continue;
    }
    if (arg === "--max-preview-lines" && next) {
      options.maxPreviewLines = parsePositiveInteger(next, "--max-preview-lines");
      index += 1;
      continue;
    }
    if (arg === "--max-preview-chars" && next) {
      options.maxPreviewChars = parsePositiveInteger(next, "--max-preview-chars");
      index += 1;
      continue;
    }
    throw new Error(`Unknown inspect option: ${arg}`);
  }
  if ((options.maxKeyFiles !== undefined || options.maxPreviewLines !== undefined || options.maxPreviewChars !== undefined) && !options.includeKeyFiles) {
    options.includeKeyFiles = true;
  }
  return options;
}

type PhaseOneCheckStatus = "pass" | "warn" | "fail";

type PhaseOneReadinessCheck = {
  id: string;
  label: string;
  status: PhaseOneCheckStatus;
  summary: string;
};

type PhaseOneReadinessResult = {
  generatedAt: string;
  root: string;
  status: "pass" | "fail";
  checks: PhaseOneReadinessCheck[];
  commands: {
    tui: string;
    init: string;
    setupWizard: string;
    status: string;
    inspect: string;
    inspectJson: string;
    inspectWithPreviews: string;
    ask: string;
    providers: string;
    modelList: string;
    modelEnv: string;
    modelCheck: string;
    configShow: string;
    quickstart: string;
    smoke: string;
    realProviderSmoke: string;
  };
};

async function verifyPhaseOneReadiness(cwd: string): Promise<PhaseOneReadinessResult> {
  const checks: PhaseOneReadinessCheck[] = [];
  const snapshot = await collectWorkspaceSnapshot(cwd);
  const rendered = renderWorkspaceSnapshot(snapshot);
  checks.push({
    id: "workspace-snapshot",
    label: "workspace snapshot",
    status: snapshot.topLevel.length > 0 && snapshot.projectSignals.manifests.length > 0 ? "pass" : "fail",
    summary: `captured ${snapshot.topLevel.length} top-level entries and ${snapshot.projectSignals.manifests.length} manifest signal(s)`,
  });
  checks.push({
    id: "rendered-context",
    label: "rendered context",
    status: rendered.includes("project signals:") && rendered.includes("suggested files to inspect next:") ? "pass" : "fail",
    summary: "human-readable context includes project signals and next-file suggestions",
  });

  const previews = await collectWorkspaceKeyFilePreviews(cwd, snapshot, {
    maxFiles: 3,
    maxLines: 30,
  });
  checks.push({
    id: "key-file-previews",
    label: "key-file previews",
    status: previews.length > 0 ? "pass" : "warn",
    summary: previews.length > 0 ? `previewed ${previews.length} bounded key file(s)` : "no key files were available to preview in this workspace",
  });

  const platform = await createLocalPlatform(cwd, {
    provider: "mock",
    workspaceSnapshot: true,
    workspaceKeyFilePreviews: true,
    workspaceMaxKeyFiles: 3,
    workspaceMaxPreviewLines: 30,
  });
  try {
    const answer = await platform.agent.run("inspect this workspace");
    checks.push({
      id: "mock-agent-loop",
      label: "mock agent loop",
      status: answer.trim().length > 0 ? "pass" : "fail",
      summary: answer.trim().length > 0 ? "local agent loop returned a final answer with workspace context enabled" : "local agent loop returned an empty answer",
    });
  } catch (error) {
    checks.push({
      id: "mock-agent-loop",
      label: "mock agent loop",
      status: "fail",
      summary: error instanceof Error ? error.message : String(error),
    });
  } finally {
    platform.locks.close?.();
    platform.store.close();
  }

  const profiles = await new LocalProviderProfileStore(path.join(cwd, ".agent")).list();
  const configuredProviders = profiles.filter((profile) => profile.name !== "mock" && profile.apiKeyEnvNames.some((name) => Boolean(process.env[name])));
  checks.push({
    id: "real-provider",
    label: "real provider",
    status: "warn",
    summary:
      configuredProviders.length > 0
        ? `provider env present for ${configuredProviders.map((profile) => profile.name).join(", ")}; run the smoke command to verify live model access`
        : "no live provider was called by this local check; set an API key env and run the smoke command below",
  });

  const status: "pass" | "fail" = checks.some((check) => check.status === "fail") ? "fail" : "pass";
  return {
    generatedAt: new Date().toISOString(),
    root: cwd,
    status,
    checks,
    commands: {
      tui: "soloclaw",
      init: "soloclaw init",
      setupWizard: "soloclaw setup --wizard",
      status: "soloclaw status",
      inspect: "soloclaw inspect",
      inspectJson: "soloclaw inspect --json",
      inspectWithPreviews: "soloclaw inspect --include-key-files --max-key-files 3 --max-preview-lines 30",
      ask: 'soloclaw ask "inspect this workspace"',
      providers: "soloclaw providers --json",
      modelList: "soloclaw model list --json",
      modelEnv: "soloclaw model env",
      modelCheck: "soloclaw model check --json",
      configShow: "soloclaw config show --json",
      quickstart: "soloclaw quickstart",
      smoke: "soloclaw smoke",
      realProviderSmoke: 'soloclaw ask --provider openai --api-key-env OPENAI_API_KEY "inspect this workspace"',
    },
  };
}

function printPhaseOneReadiness(result: PhaseOneReadinessResult): void {
  console.log(`Phase 1 local CLI readiness: ${result.status}`);
  console.log(`root: ${result.root}`);
  for (const check of result.checks) {
    console.log(`[${check.status}] ${check.label}: ${check.summary}`);
  }
  console.log("");
  console.log("Demo commands:");
  console.log(`- ${result.commands.tui}`);
  console.log(`- ${result.commands.init}`);
  console.log(`- ${result.commands.setupWizard}`);
  console.log(`- ${result.commands.status}`);
  console.log(`- ${result.commands.inspect}`);
  console.log(`- ${result.commands.inspectJson}`);
  console.log(`- ${result.commands.inspectWithPreviews}`);
  console.log(`- ${result.commands.ask}`);
  console.log(`- ${result.commands.providers}`);
  console.log(`- ${result.commands.modelList}`);
  console.log(`- ${result.commands.modelEnv}`);
  console.log(`- ${result.commands.modelCheck}`);
  console.log(`- ${result.commands.configShow}`);
  console.log(`- ${result.commands.quickstart}`);
  console.log(`- ${result.commands.smoke}`);
  console.log(`Next real-provider smoke: ${result.commands.realProviderSmoke}`);
}

type PhaseTwoEngineeringSmokeCheck = {
  id: string;
  label: string;
  status: "pass" | "fail";
  summary: string;
};

type PhaseTwoEngineeringSmokeResult = {
  generatedAt: string;
  root: string;
  sampleWorkspace: string;
  status: "pass" | "fail";
  phaseClosure: "partial";
  sessionId?: string;
  patch: string;
  checks: PhaseTwoEngineeringSmokeCheck[];
  evidence: {
    initialTestExitCode?: number | null;
    recoveredTestExitCode?: number | null;
    fileChanges: number;
    toolAuditEvents: number;
    commandAuditEvents: number;
    toolResults: number;
    sessionDiffPatches: number;
    sessionDiffFileChanges: number;
    sessionDiffChangedPaths: string[];
    sessionDiffStats: UnifiedDiffStats;
    sessionDiffFileSummaries: UnifiedDiffFileSummary[];
    sessionReportFileChanges: number;
    sessionReportToolResults: number;
    sessionReportCommandsFinished: number;
    sessionReportTimedOutCommands: number;
    sessionReportExecutionProfiles: Record<string, number>;
    sessionReportDiffStats: UnifiedDiffStats;
    sessionReportFileSummaries: UnifiedDiffFileSummary[];
    sessionReportPendingApprovals: number;
    sessionResultOutcome?: string;
    sessionResultRecovered: boolean;
    sessionResultCommandsFinished: number;
    sessionResultTimedOutCommands: number;
    sessionResultExecutionProfiles: Record<string, number>;
    sessionResultDiffStats: UnifiedDiffStats;
    sessionResultFileSummaries: UnifiedDiffFileSummary[];
    sessionResultPendingApprovals: number;
    sessionResultChangedPaths: string[];
    sessionTimelineItems: number;
    sessionTimelineReturnedItems: number;
    sessionTimelineKinds: Record<string, number>;
    sessionStatusOutcome?: string;
    sessionStatusTimelineItems: number;
    sessionListReturned: number;
    sessionListOutcome?: string;
    sessionListPendingApprovals: number;
    sessionReviewState?: string;
    sessionReviewChecklist: Record<string, string>;
    sessionReviewChangedPaths: string[];
    sessionReviewPatches: number;
    sessionReviewDiffStats: UnifiedDiffStats;
    sessionReviewFileSummaries: UnifiedDiffFileSummary[];
    sessionReviewTimelineItems: number;
    sessionVerificationStatus?: string;
    sessionVerificationChecks: number;
    sessionBundleVerificationStatus?: string;
    sessionBundleSections: string[];
    sessionBundleOutputBytes: number;
    sessionBundleTimelineItems: number;
    policyBoundaryApprovalActions: string[];
    policyBoundaryApprovalCount: number;
    timeoutCommandTimedOut: boolean;
    timeoutCommandExitCode?: number | null;
    runSessionId?: string;
    runSessionOutcome?: string;
    runSessionToolResults: number;
    runSessionVerificationStatus?: string;
    agentRepairWorkspace?: string;
    agentRepairSessionId?: string;
    agentRepairOutcome?: string;
    agentRepairRecovered: boolean;
    agentRepairVerificationStatus?: string;
    agentRepairCommandsFinished: number;
    agentRepairFailedCommands: number;
    agentRepairFileChanges: number;
    agentRepairPatches: number;
    agentRepairToolResults: number;
    agentRepairChangedPaths: string[];
    resumeSessionId?: string;
    resumeOutcome?: string;
    resumeVerificationStatus?: string;
    resumeToolResults: number;
    resumeAuditEvents: number;
    queuedApprovalSessionId?: string;
    queuedApprovalWorkerId?: string;
    queuedApprovalAssignmentId?: string;
    queuedApprovalOutcome?: string;
    queuedApprovalCompleted: boolean;
    queuedApprovalFileChanges: number;
    queuedApprovalToolResults: number;
    queuedApprovalAuditEvents: number;
    targetModeWorkspace?: string;
    targetModeSessions: Array<{
      mode: string;
      sessionId?: string;
      outcome?: string;
      verificationStatus?: string;
      toolResults: number;
      commandsFinished: number;
    }>;
    lifecycleAuditEvents: number;
    lifecycleSessionIds: string[];
    pauseStatus?: string;
    resumeStatus?: string;
    cancelStatus?: string;
    cleanup: boolean;
    initialTestOutputExcerpt?: string;
    recoveredTestOutputExcerpt?: string;
  };
  commands: {
    inspectSession?: string;
    changes?: string;
    audit?: string;
    sessionDiff?: string;
    sessionReport?: string;
    sessionStatus?: string;
    sessionTimeline?: string;
    sessionReview?: string;
    sessionResult?: string;
    sessionVerify?: string;
    sessionBundle?: string;
    runJson?: string;
    agentRepairResult?: string;
    agentRepairVerify?: string;
    resumeResult?: string;
    targetModeResult?: string;
  };
};

async function verifyPhaseTwoEngineeringSmoke(cwd: string, options: { cleanup?: boolean } = {}): Promise<PhaseTwoEngineeringSmokeResult> {
  const sampleWorkspace = path.join(cwd, ".agent", "tmp", `phase2-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const checks: PhaseTwoEngineeringSmokeCheck[] = [];
  await createPhaseTwoSampleWorkspace(sampleWorkspace);

  const platform = await createLocalPlatform(sampleWorkspace, {
    provider: "mock",
  });
  const actor = localUserActor();
  const session = await platform.store.createSession({
    objective: "Phase 2 engineering smoke: repair a failing sample test with a unified diff patch.",
    targetMode: "build",
    status: "running",
    risk: "medium",
    createdBy: actor,
  });

  try {
    await platform.store.appendMessage({
      sessionId: session.id,
      message: {
        role: "user",
        content: "Run the sample test, apply the planned patch, rerun the test, and persist the evidence.",
      },
    });

    const { createWorkspaceTools } = await import("../tools/workspace-tools.js");
    const { withPolicy } = await import("../tools/policy-tools.js");
    const tools = withPolicy(createWorkspaceTools(platform.workspace, {
      store: platform.store,
      locks: platform.locks,
      actor,
      sessionId: session.id,
    }), {
      actor,
      mode: "trusted",
      risk: "medium",
      policy: platform.policy,
      store: platform.store,
      sessionId: session.id,
    });
    const runCommand = requiredTool(tools, "run_command");
    const applyPatch = requiredTool(tools, "apply_patch");
    const balancedPolicyTools = withPolicy(createWorkspaceTools(platform.workspace, {
      store: platform.store,
      locks: platform.locks,
      actor,
      sessionId: session.id,
    }), {
      actor,
      mode: "balanced",
      risk: "medium",
      policy: platform.policy,
      store: platform.store,
      sessionId: session.id,
    });
    const balancedApplyPatch = requiredTool(balancedPolicyTools, "apply_patch");

    checks.push({
      id: "sample-workspace",
      label: "sample workspace",
      status: "pass",
      summary: `created disposable sample repository at ${sampleWorkspace}`,
    });

    const testCommand = "node test/math.test.js";
    const initialTest = await runCommand.handler({ command: testCommand, timeoutMs: 20_000 });
    await platform.store.recordToolCall({ sessionId: session.id, result: initialTest });
    const initialExitCode = toolOutputExitCode(initialTest.output);
    checks.push({
      id: "failing-test-observed",
      label: "failing test observed",
      status: initialTest.ok && initialExitCode !== 0 ? "pass" : "fail",
      summary: initialTest.ok && initialExitCode !== 0 ? `initial test failed as expected with exit=${initialExitCode}` : "initial test did not fail as expected",
    });

    const timeoutCommand = "node -e \"setTimeout(() => {}, 250)\"";
    const timedOutCommand = await runCommand.handler({ command: timeoutCommand, timeoutMs: 20 });
    await platform.store.recordToolCall({ sessionId: session.id, result: timedOutCommand });
    const timeoutExitCode = toolOutputExitCode(timedOutCommand.output);
    const timeoutObserved = timedOutCommand.ok && toolOutputTimedOut(timedOutCommand.output);
    checks.push({
      id: "command-timeout-evidence",
      label: "command timeout evidence",
      status: timeoutObserved ? "pass" : "fail",
      summary: timeoutObserved ? `timeout command recorded exit=${timeoutExitCode ?? "null"}` : "timeout command did not record timedOut=true",
    });

    const patch = phaseTwoSamplePatch();
    const patched = await applyPatch.handler({ patch });
    await platform.store.recordToolCall({ sessionId: session.id, result: patched });
    checks.push({
      id: "patch-applied",
      label: "patch applied",
      status: patched.ok ? "pass" : "fail",
      summary: patched.ok ? patchToolSummary(patched.output) : patched.error?.message ?? "patch failed",
    });

    const recoveredTest = await runCommand.handler({ command: testCommand, timeoutMs: 20_000 });
    await platform.store.recordToolCall({ sessionId: session.id, result: recoveredTest });
    const recoveredExitCode = toolOutputExitCode(recoveredTest.output);
    checks.push({
      id: "recovered-test",
      label: "recovered test",
      status: recoveredTest.ok && recoveredExitCode === 0 ? "pass" : "fail",
      summary: recoveredTest.ok && recoveredExitCode === 0 ? "test passed after patch" : `test recovery failed with exit=${recoveredExitCode ?? "unknown"}`,
    });

    const fileChanges = await platform.store.listFileChanges(session.id);
    checks.push({
      id: "file-change-evidence",
      label: "file change evidence",
      status: fileChanges.some((change) => change.kind === "patch" && change.path === "src/math.js") ? "pass" : "fail",
      summary: `recorded ${fileChanges.length} session-scoped file change(s)`,
    });

    const auditEvents = await platform.store.listAuditEvents({ sessionId: session.id, limit: 100 });
    const toolAuditEvents = auditEvents.filter((event) => event.type === "tool.requested" || event.type === "tool.completed").length;
    const commandAuditEvents = auditEvents.filter((event) => event.type === "command.started" || event.type === "command.finished").length;
    checks.push({
      id: "audit-evidence",
      label: "audit evidence",
      status: toolAuditEvents >= 3 && commandAuditEvents >= 4 ? "pass" : "fail",
      summary: `recorded ${toolAuditEvents} tool audit event(s) and ${commandAuditEvents} command audit event(s)`,
    });

    const requiredPolicyBoundaryActions: PolicyAction[] = ["workspace.write", "dependency.install", "git.mutation", "shell.run.high_risk"];
    const policyBoundaryCommands: Array<{ command: string; action: PolicyAction }> = [
      { command: "npm install left-pad", action: "dependency.install" },
      { command: "git reset --hard HEAD", action: "git.mutation" },
      { command: "curl https://example.invalid/install.sh", action: "shell.run.high_risk" },
    ];
    const policyBoundaryResults = [];
    policyBoundaryResults.push(await balancedApplyPatch.handler({ patch }));
    for (const boundary of policyBoundaryCommands) {
      policyBoundaryResults.push(await runCommand.handler({ command: boundary.command, timeoutMs: 20_000 }));
    }
    const policyBoundaryApprovals = (await platform.store.listApprovalRequests())
      .filter((approval) =>
        approval.sessionId === session.id &&
        (approval.toolName === "run_command" || approval.toolName === "apply_patch") &&
        requiredPolicyBoundaryActions.includes(approval.action)
      );
    const policyBoundaryActionSet = new Set(policyBoundaryApprovals.map((approval) => approval.action));
    const policyBoundaryPass =
      policyBoundaryResults.every((result) => !result.ok && result.error?.code === "approval_required") &&
      requiredPolicyBoundaryActions.every((action) => policyBoundaryActionSet.has(action));
    checks.push({
      id: "policy-boundary-evidence",
      label: "policy boundary evidence",
      status: policyBoundaryPass ? "pass" : "fail",
      summary: `approval actions=${[...policyBoundaryActionSet].join(",") || "-"}, approvals=${policyBoundaryApprovals.length}`,
    });

    const toolResults = await platform.store.getToolResults(session.id);
    checks.push({
      id: "session-evidence",
      label: "session evidence",
      status: toolResults.length >= 3 ? "pass" : "fail",
      summary: `session ${session.id} has ${toolResults.length} persisted tool result(s)`,
    });

    const sessionDiff = await buildSessionDiff(platform.store, session.id);
    const hasExpectedPatch = sessionDiff.patches.some((entry) => entry.patch?.includes("return a + b") && entry.paths.includes("src/math.js"));
    checks.push({
      id: "session-diff-evidence",
      label: "session diff evidence",
      status: sessionDiff.summary.patches >= 1 && sessionDiff.summary.changedPaths.includes("src/math.js") && hasExpectedPatch ? "pass" : "fail",
      summary: `session diff exposes ${sessionDiff.summary.patches} patch(es) across ${sessionDiff.summary.changedPaths.length} changed path(s)`,
    });
    const sessionDiffStatPass =
      sessionDiff.summary.diffStats.files === 1 &&
      sessionDiff.summary.diffStats.additions === 1 &&
      sessionDiff.summary.diffStats.deletions === 1 &&
      sessionDiff.summary.diffStats.byPath.some((entry) => entry.path === "src/math.js" && entry.additions === 1 && entry.deletions === 1);
    checks.push({
      id: "session-diff-stat-evidence",
      label: "session diff stat evidence",
      status: sessionDiffStatPass ? "pass" : "fail",
      summary: `diffStats=${formatDiffStats(sessionDiff.summary.diffStats)}`,
    });
    const sessionFileSummary = sessionDiff.summary.fileSummaries.find((entry) => entry.path === "src/math.js");
    const sessionFileSummaryPass =
      sessionFileSummary?.changeType === "modified" &&
      sessionFileSummary.additions === 1 &&
      sessionFileSummary.deletions === 1 &&
      sessionFileSummary.patches === 1 &&
      sessionFileSummary.reviewSize === "small";
    checks.push({
      id: "session-file-summary-evidence",
      label: "session file summary evidence",
      status: sessionFileSummaryPass ? "pass" : "fail",
      summary: sessionFileSummary ? formatDiffFileSummary(sessionFileSummary) : "src/math.js summary missing",
    });

    const sessionReport = await buildSessionReport(platform.store, session.id);
    const requiredExecutionProfiles: CommandExecutionProfileName[] = ["local-safe"];
    checks.push({
      id: "session-report-evidence",
      label: "session report evidence",
      status:
        sessionReport.summary.fileChanges >= 1 &&
        sessionReport.summary.toolResults >= 3 &&
        sessionReport.summary.commandsFinished >= 2 &&
        sessionReport.summary.timedOutCommands >= 1 &&
        sessionReport.summary.pendingApprovals >= requiredPolicyBoundaryActions.length &&
        sessionReport.summary.diffStats.additions >= 1 &&
        sessionReport.summary.diffStats.deletions >= 1 &&
        sessionReport.summary.changedPaths.includes("src/math.js")
          ? "pass"
          : "fail",
      summary:
        `session report shows ${sessionReport.summary.fileChanges} file change(s), ` +
        `${sessionReport.summary.toolResults} tool result(s), ${sessionReport.summary.commandsFinished} finished command(s), ` +
        `${sessionReport.summary.timedOutCommands} timeout(s), and ${sessionReport.summary.pendingApprovals} pending approval(s)`,
    });

    const statusBeforeResult = checks.some((check) => check.status === "fail") ? "fail" : "pass";
    await platform.store.updateSessionStatus(session.id, statusBeforeResult === "pass" ? "completed" : "failed");
    const sessionResult = await buildSessionResult(platform.store, session.id);
    checks.push({
      id: "session-result-evidence",
      label: "session result evidence",
      status:
        sessionResult.summary.outcome === "succeeded" &&
        sessionResult.summary.recovered &&
        sessionResult.summary.changedPaths.includes("src/math.js") &&
        sessionResult.summary.timedOutCommands >= 1 &&
        sessionResult.summary.pendingApprovals >= requiredPolicyBoundaryActions.length &&
        sessionResult.summary.diffStats.additions >= 1 &&
        sessionResult.summary.diffStats.deletions >= 1 &&
        sessionResult.summary.commandsFinished >= 2
          ? "pass"
          : "fail",
      summary:
        `session result outcome=${sessionResult.summary.outcome}, recovered=${sessionResult.summary.recovered}, ` +
        `commands=${sessionResult.summary.commandsFinished}, timedOut=${sessionResult.summary.timedOutCommands}, pendingApprovals=${sessionResult.summary.pendingApprovals}`,
    });

    const executionProfilePass = requiredExecutionProfiles.every((profile) =>
      (sessionReport.summary.executionProfiles[profile] ?? 0) > 0 &&
      (sessionResult.summary.executionProfiles[profile] ?? 0) > 0
    );
    checks.push({
      id: "command-profile-evidence",
      label: "command profile evidence",
      status: executionProfilePass ? "pass" : "fail",
      summary:
        `reportProfiles=${formatRecordCounts(sessionReport.summary.executionProfiles)}, ` +
        `resultProfiles=${formatRecordCounts(sessionResult.summary.executionProfiles)}`,
    });

    const sessionTimeline = await buildSessionTimeline(platform.store, session.id);
    const sessionTimelineHasCommandProfile = sessionTimeline.items.some((item) =>
      item.kind === "audit" &&
      item.title === "command.finished" &&
      item.executionProfile === "local-safe"
    );
    const sessionTimelinePass =
      sessionTimeline.summary.totalItems >= 10 &&
      (sessionTimeline.summary.byKind.audit ?? 0) >= 6 &&
      (sessionTimeline.summary.byKind.file_change ?? 0) >= 1 &&
      (sessionTimeline.summary.byKind.approval ?? 0) >= requiredPolicyBoundaryActions.length &&
      sessionTimelineHasCommandProfile;
    checks.push({
      id: "session-timeline-evidence",
      label: "session timeline evidence",
      status: sessionTimelinePass ? "pass" : "fail",
      summary:
        `items=${sessionTimeline.summary.returnedItems}/${sessionTimeline.summary.totalItems}, ` +
        `byKind=${formatRecordCounts(sessionTimeline.summary.byKind)}`,
    });

    const sessionStatus = await buildSessionStatus(platform.store, session.id);
    checks.push({
      id: "session-status-evidence",
      label: "session status evidence",
      status:
        sessionStatus.summary.outcome === "succeeded" &&
        sessionStatus.summary.timelineItems === sessionTimeline.summary.totalItems &&
        sessionStatus.summary.pendingApprovals >= requiredPolicyBoundaryActions.length
          ? "pass"
          : "fail",
      summary:
        `outcome=${sessionStatus.summary.outcome}, timelineItems=${sessionStatus.summary.timelineItems}, ` +
        `pendingApprovals=${sessionStatus.summary.pendingApprovals}`,
    });
    const sessionList = await buildSessionList(platform.store, { limit: 5 });
    const sessionListEntry = sessionList.sessions.find((entry) => entry.session.id === session.id);
    checks.push({
      id: "session-list-evidence",
      label: "session list evidence",
      status:
        sessionListEntry?.summary.outcome === "succeeded" &&
        sessionListEntry.summary.pendingApprovals >= requiredPolicyBoundaryActions.length &&
        sessionListEntry.reviewCommands.result.includes(session.id)
          ? "pass"
          : "fail",
      summary:
        `sessions=${sessionList.summary.returned}/${sessionList.summary.scanned}, ` +
        `outcome=${sessionListEntry?.summary.outcome ?? "-"}, pendingApprovals=${sessionListEntry?.summary.pendingApprovals ?? 0}`,
    });

    const sessionReview = await buildSessionReview(platform.store, session.id, { limit: 20 });
    const sessionReviewChecklist = Object.fromEntries(sessionReview.checklist.map((item) => [item.id, item.status]));
    const sessionReviewPass =
      sessionReview.summary.reviewState === "waiting_for_approval" &&
      sessionReviewChecklist["change-summary"] === "pass" &&
      sessionReviewChecklist["patch-review"] === "pass" &&
      sessionReviewChecklist["command-result"] === "pass" &&
      sessionReviewChecklist["failure-recovery"] === "pass" &&
      sessionReviewChecklist["approval-state"] === "warn" &&
      sessionReviewChecklist["tool-errors"] === "pass" &&
      sessionReview.changes.changedPaths.includes("src/math.js") &&
      sessionReview.changes.patches.length >= 1 &&
      sessionReview.changes.diffStats.additions >= 1 &&
      sessionReview.changes.diffStats.deletions >= 1 &&
      sessionReview.latestTimeline.length > 0;
    checks.push({
      id: "session-review-evidence",
      label: "session review evidence",
      status: sessionReviewPass ? "pass" : "fail",
      summary:
        `reviewState=${sessionReview.summary.reviewState}, checklist=${sessionReview.checklist.map((item) => `${item.id}:${item.status}`).join(",")}, ` +
        `changedPaths=${sessionReview.changes.changedPaths.join(",") || "-"}, patches=${sessionReview.changes.patches.length}`,
    });

    const sessionVerification = await buildSessionVerification(platform.store, session.id, {
      requireChange: true,
      requirePatch: true,
      requireRecovery: true,
      requireTimeout: true,
      requireDiffStat: true,
      requiredExecutionProfiles,
      requiredApprovalActions: requiredPolicyBoundaryActions,
    });
    checks.push({
      id: "session-verification-gate",
      label: "session verification gate",
      status: sessionVerification.status,
      summary: `verification=${sessionVerification.status}, checks=${sessionVerification.checks.length}`,
    });

    const sessionBundle = await buildSessionEvidenceBundle(platform.store, session.id, {
      limit: 20,
      requireChange: true,
      requirePatch: true,
      requireRecovery: true,
      requireTimeout: true,
      requireDiffStat: true,
      requiredExecutionProfiles,
      requiredApprovalActions: requiredPolicyBoundaryActions,
    });
    const sessionBundleOutput = await writeJsonOutputInsideWorkspace(sampleWorkspace, ".agent/tmp/session-bundle.json", sessionBundle);
    const sessionBundleSections = Object.keys(sessionBundle.sections).sort();
    checks.push({
      id: "session-bundle-evidence",
      label: "session bundle evidence",
      status:
        sessionBundle.summary.outcome === "succeeded" &&
        sessionBundle.summary.verificationStatus === "pass" &&
        sessionBundleSections.includes("diff") &&
        sessionBundleSections.includes("report") &&
        sessionBundleSections.includes("review") &&
        sessionBundleSections.includes("result") &&
        sessionBundleSections.includes("verification") &&
        sessionBundleOutput.bytes > 100
          ? "pass"
          : "fail",
      summary:
        `bundleVerification=${sessionBundle.summary.verificationStatus}, sections=${sessionBundleSections.join(",")}, ` +
        `outputBytes=${sessionBundleOutput.bytes}`,
    });

    const runSmoke = await platform.agent.runWithSession("inspect this workspace through the engineering run path");
    const runSessionResult = runSmoke.session ? await buildSessionResult(platform.store, runSmoke.session.id) : undefined;
    const runSessionVerification = runSmoke.session
      ? await buildSessionVerification(platform.store, runSmoke.session.id, { requireCommand: false })
      : undefined;
    checks.push({
      id: "run-session-evidence",
      label: "run session evidence",
      status:
        runSmoke.session &&
        runSessionResult?.summary.outcome === "succeeded" &&
        (runSessionResult.summary.toolResults ?? 0) >= 1 &&
        runSessionVerification?.status === "pass"
          ? "pass"
          : "fail",
      summary:
        `runSession=${runSmoke.session?.id ?? "-"}, outcome=${runSessionResult?.summary.outcome ?? "-"}, ` +
        `verification=${runSessionVerification?.status ?? "-"}`,
    });

    const agentRepair = await runPhaseTwoAgentRepairSmoke(cwd, { cleanup: options.cleanup });
    checks.push({
      id: "agent-loop-repair-evidence",
      label: "agent loop repair evidence",
      status:
        agentRepair.outcome === "succeeded" &&
        agentRepair.recovered &&
        agentRepair.verificationStatus === "pass" &&
        agentRepair.changedPaths.includes("src/math.js") &&
        agentRepair.patches >= 1
          ? "pass"
          : "fail",
      summary:
        `agentRepair=${agentRepair.sessionId ?? "-"}, outcome=${agentRepair.outcome ?? "-"}, ` +
        `verification=${agentRepair.verificationStatus ?? "-"}, patches=${agentRepair.patches}`,
    });

    const resumeSmoke = await runPhaseTwoResumeSmoke(platform, actor);
    checks.push({
      id: "resume-session-evidence",
      label: "resume session evidence",
      status:
        resumeSmoke.outcome === "succeeded" &&
        resumeSmoke.verificationStatus === "pass" &&
        resumeSmoke.toolResults >= 1 &&
        resumeSmoke.auditEvents >= 1
          ? "pass"
          : "fail",
      summary:
        `resumeSession=${resumeSmoke.sessionId ?? "-"}, outcome=${resumeSmoke.outcome ?? "-"}, ` +
        `verification=${resumeSmoke.verificationStatus ?? "-"}, auditEvents=${resumeSmoke.auditEvents}`,
    });

    const queuedApproval = await runPhaseTwoQueuedApprovalContinuationSmoke(platform, actor);
    checks.push({
      id: "queued-approval-continuation-evidence",
      label: "queued approval continuation evidence",
      status:
        queuedApproval.completed &&
        queuedApproval.outcome === "succeeded" &&
        queuedApproval.fileChanges >= 1 &&
        queuedApproval.toolResults >= 2 &&
        queuedApproval.auditEvents >= 1
          ? "pass"
          : "fail",
      summary:
        `session=${queuedApproval.sessionId ?? "-"}, worker=${queuedApproval.workerId ?? "-"}, ` +
        `assignment=${queuedApproval.assignmentId ?? "-"}, outcome=${queuedApproval.outcome ?? "-"}, completed=${queuedApproval.completed}`,
    });

    const targetModes = await runPhaseTwoTargetModeSmoke(cwd, { cleanup: options.cleanup });
    const targetModePass = targetModes.sessions.every((entry) =>
      entry.sessionId &&
      entry.outcome === "succeeded" &&
      entry.verificationStatus === "pass" &&
      entry.targetMode === entry.mode
    );
    checks.push({
      id: "target-mode-evidence",
      label: "target mode evidence",
      status: targetModePass ? "pass" : "fail",
      summary: targetModes.sessions
        .map((entry) => `${entry.mode}:${entry.outcome ?? "-"}:${entry.verificationStatus ?? "-"}`)
        .join(", "),
    });

    const lifecycle = await runPhaseTwoLifecycleSmoke(platform, actor);
    checks.push({
      id: "lifecycle-evidence",
      label: "lifecycle evidence",
      status: lifecycle.ok ? "pass" : "fail",
      summary:
        `pause=${lifecycle.pauseStatus}, resume=${lifecycle.resumeStatus}, cancel=${lifecycle.cancelStatus}, ` +
        `auditEvents=${lifecycle.auditEvents}`,
    });

    const status = checks.some((check) => check.status === "fail") ? "fail" : "pass";
    await platform.store.addSessionSummary({
      id: `sum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: session.id,
      summary: `Phase 2 engineering smoke ${status}: failing test exit=${initialExitCode ?? "unknown"}, recovered exit=${recoveredExitCode ?? "unknown"}.`,
      createdAt: new Date().toISOString(),
    });
    if (status !== statusBeforeResult) {
      await platform.store.updateSessionStatus(session.id, status === "pass" ? "completed" : "failed");
    }

    return {
      generatedAt: new Date().toISOString(),
      root: cwd,
      sampleWorkspace,
      status,
      phaseClosure: "partial",
      sessionId: session.id,
      patch,
      checks,
      evidence: {
        initialTestExitCode: initialExitCode,
        recoveredTestExitCode: recoveredExitCode,
        fileChanges: fileChanges.length,
        toolAuditEvents,
        commandAuditEvents,
        toolResults: toolResults.length,
        sessionDiffPatches: sessionDiff.summary.patches,
        sessionDiffFileChanges: sessionDiff.summary.fileChanges,
        sessionDiffChangedPaths: sessionDiff.summary.changedPaths,
        sessionDiffStats: sessionDiff.summary.diffStats,
        sessionDiffFileSummaries: sessionDiff.summary.fileSummaries,
        sessionReportFileChanges: sessionReport.summary.fileChanges,
        sessionReportToolResults: sessionReport.summary.toolResults,
        sessionReportCommandsFinished: sessionReport.summary.commandsFinished,
        sessionReportTimedOutCommands: sessionReport.summary.timedOutCommands,
        sessionReportExecutionProfiles: sessionReport.summary.executionProfiles,
        sessionReportDiffStats: sessionReport.summary.diffStats,
        sessionReportFileSummaries: sessionReport.summary.fileSummaries,
        sessionReportPendingApprovals: sessionReport.summary.pendingApprovals,
        sessionResultOutcome: sessionResult.summary.outcome,
        sessionResultRecovered: sessionResult.summary.recovered,
        sessionResultCommandsFinished: sessionResult.summary.commandsFinished,
        sessionResultTimedOutCommands: sessionResult.summary.timedOutCommands,
        sessionResultExecutionProfiles: sessionResult.summary.executionProfiles,
        sessionResultDiffStats: sessionResult.summary.diffStats,
        sessionResultFileSummaries: sessionResult.summary.fileSummaries,
        sessionResultPendingApprovals: sessionResult.summary.pendingApprovals,
        sessionResultChangedPaths: sessionResult.summary.changedPaths,
        sessionTimelineItems: sessionTimeline.summary.totalItems,
        sessionTimelineReturnedItems: sessionTimeline.summary.returnedItems,
        sessionTimelineKinds: sessionTimeline.summary.byKind,
        sessionStatusOutcome: sessionStatus.summary.outcome,
        sessionStatusTimelineItems: sessionStatus.summary.timelineItems,
        sessionListReturned: sessionList.summary.returned,
        sessionListOutcome: sessionListEntry?.summary.outcome,
        sessionListPendingApprovals: sessionListEntry?.summary.pendingApprovals ?? 0,
        sessionReviewState: sessionReview.summary.reviewState,
        sessionReviewChecklist,
        sessionReviewChangedPaths: sessionReview.changes.changedPaths,
        sessionReviewPatches: sessionReview.changes.patches.length,
        sessionReviewDiffStats: sessionReview.changes.diffStats,
        sessionReviewFileSummaries: sessionReview.changes.fileSummaries,
        sessionReviewTimelineItems: sessionReview.summary.timelineItems,
        sessionVerificationStatus: sessionVerification.status,
        sessionVerificationChecks: sessionVerification.checks.length,
        sessionBundleVerificationStatus: sessionBundle.summary.verificationStatus,
        sessionBundleSections,
        sessionBundleOutputBytes: sessionBundleOutput.bytes,
        sessionBundleTimelineItems: sessionBundle.summary.timelineItems,
        policyBoundaryApprovalActions: [...policyBoundaryActionSet],
        policyBoundaryApprovalCount: policyBoundaryApprovals.length,
        timeoutCommandTimedOut: timeoutObserved,
        timeoutCommandExitCode: timeoutExitCode,
        runSessionId: runSmoke.session?.id,
        runSessionOutcome: runSessionResult?.summary.outcome,
        runSessionToolResults: runSessionResult?.summary.toolResults ?? 0,
        runSessionVerificationStatus: runSessionVerification?.status,
        agentRepairWorkspace: agentRepair.workspace,
        agentRepairSessionId: agentRepair.sessionId,
        agentRepairOutcome: agentRepair.outcome,
        agentRepairRecovered: agentRepair.recovered,
        agentRepairVerificationStatus: agentRepair.verificationStatus,
        agentRepairCommandsFinished: agentRepair.commandsFinished,
        agentRepairFailedCommands: agentRepair.failedCommands,
        agentRepairFileChanges: agentRepair.fileChanges,
        agentRepairPatches: agentRepair.patches,
        agentRepairToolResults: agentRepair.toolResults,
        agentRepairChangedPaths: agentRepair.changedPaths,
        resumeSessionId: resumeSmoke.sessionId,
        resumeOutcome: resumeSmoke.outcome,
        resumeVerificationStatus: resumeSmoke.verificationStatus,
        resumeToolResults: resumeSmoke.toolResults,
        resumeAuditEvents: resumeSmoke.auditEvents,
        queuedApprovalSessionId: queuedApproval.sessionId,
        queuedApprovalWorkerId: queuedApproval.workerId,
        queuedApprovalAssignmentId: queuedApproval.assignmentId,
        queuedApprovalOutcome: queuedApproval.outcome,
        queuedApprovalCompleted: queuedApproval.completed,
        queuedApprovalFileChanges: queuedApproval.fileChanges,
        queuedApprovalToolResults: queuedApproval.toolResults,
        queuedApprovalAuditEvents: queuedApproval.auditEvents,
        targetModeWorkspace: targetModes.workspace,
        targetModeSessions: targetModes.sessions.map((entry) => ({
          mode: entry.mode,
          sessionId: entry.sessionId,
          outcome: entry.outcome,
          verificationStatus: entry.verificationStatus,
          toolResults: entry.toolResults,
          commandsFinished: entry.commandsFinished,
        })),
        lifecycleAuditEvents: lifecycle.auditEvents,
        lifecycleSessionIds: lifecycle.sessionIds,
        pauseStatus: lifecycle.pauseStatus,
        resumeStatus: lifecycle.resumeStatus,
        cancelStatus: lifecycle.cancelStatus,
        cleanup: Boolean(options.cleanup),
        initialTestOutputExcerpt: toolOutputExcerpt(initialTest.output),
        recoveredTestOutputExcerpt: toolOutputExcerpt(recoveredTest.output),
      },
      commands: {
        inspectSession: `cd ${sampleWorkspace} && agent show-session ${session.id}`,
        changes: `cd ${sampleWorkspace} && agent changes ${session.id}`,
        audit: `cd ${sampleWorkspace} && agent audit list --session ${session.id}`,
        sessionDiff: `cd ${sampleWorkspace} && agent session diff ${session.id}`,
        sessionReport: `cd ${sampleWorkspace} && agent session report ${session.id} --json`,
        sessionStatus: `cd ${sampleWorkspace} && agent session status ${session.id} --json`,
        sessionTimeline: `cd ${sampleWorkspace} && agent session timeline ${session.id} --limit 20`,
        sessionReview: `cd ${sampleWorkspace} && agent session review ${session.id}`,
        sessionResult: `cd ${sampleWorkspace} && agent session result ${session.id}`,
        sessionVerify:
          `cd ${sampleWorkspace} && agent session verify ${session.id} --require-change --require-patch --require-recovery ` +
          `--require-timeout --require-diff-stat --require-execution-profile ${requiredExecutionProfiles.join(",")} --require-approval-actions ${requiredPolicyBoundaryActions.join(",")}`,
        sessionBundle: `cd ${sampleWorkspace} && agent session bundle ${session.id} --json --output .agent/tmp/session-bundle.json --require-change --require-patch --require-recovery --require-timeout --require-diff-stat --require-execution-profile ${requiredExecutionProfiles.join(",")} --require-approval-actions ${requiredPolicyBoundaryActions.join(",")}`,
        runJson: `cd ${sampleWorkspace} && agent run --json --allow-no-command --verify-session "inspect this workspace"`,
        agentRepairResult: agentRepair.sessionId ? `cd ${agentRepair.workspace} && agent session result ${agentRepair.sessionId}` : undefined,
        agentRepairVerify: agentRepair.sessionId
          ? `cd ${agentRepair.workspace} && agent session verify ${agentRepair.sessionId} --require-change --require-patch --require-recovery`
          : undefined,
        resumeResult: resumeSmoke.sessionId ? `cd ${sampleWorkspace} && agent session result ${resumeSmoke.sessionId}` : undefined,
        targetModeResult: targetModes.sessions[0]?.sessionId ? `cd ${targetModes.workspace} && agent session result ${targetModes.sessions[0].sessionId}` : undefined,
      },
    };
  } finally {
    platform.locks.close?.();
    platform.store.close();
    if (options.cleanup) {
      await fs.rm(sampleWorkspace, { recursive: true, force: true });
    }
  }
}

function printPhaseTwoEngineeringSmoke(result: PhaseTwoEngineeringSmokeResult): void {
  console.log(`Phase 2 engineering smoke: ${result.status}`);
  console.log(`phaseClosure: ${result.phaseClosure}`);
  console.log(`root: ${result.root}`);
  console.log(`sampleWorkspace: ${result.sampleWorkspace}`);
  if (result.sessionId) {
    console.log(`session: ${result.sessionId}`);
  }
  for (const check of result.checks) {
    console.log(`[${check.status}] ${check.label}: ${check.summary}`);
  }
  console.log("");
  console.log("Evidence:");
  console.log(`- initialTestExitCode=${result.evidence.initialTestExitCode ?? "-"}`);
  console.log(`- recoveredTestExitCode=${result.evidence.recoveredTestExitCode ?? "-"}`);
  console.log(`- fileChanges=${result.evidence.fileChanges}`);
  console.log(`- toolAuditEvents=${result.evidence.toolAuditEvents}`);
  console.log(`- commandAuditEvents=${result.evidence.commandAuditEvents}`);
  console.log(`- toolResults=${result.evidence.toolResults}`);
  console.log(`- sessionDiffPatches=${result.evidence.sessionDiffPatches}`);
  console.log(`- sessionDiffChangedPaths=${result.evidence.sessionDiffChangedPaths.join(",") || "-"}`);
  console.log(`- sessionDiffStats=${formatDiffStats(result.evidence.sessionDiffStats)}`);
  console.log(`- sessionDiffFileSummaries=${formatDiffFileSummaryList(result.evidence.sessionDiffFileSummaries)}`);
  console.log(`- sessionReportFileChanges=${result.evidence.sessionReportFileChanges}`);
  console.log(`- sessionReportToolResults=${result.evidence.sessionReportToolResults}`);
  console.log(`- sessionReportCommandsFinished=${result.evidence.sessionReportCommandsFinished}`);
  console.log(`- sessionReportTimedOutCommands=${result.evidence.sessionReportTimedOutCommands}`);
  console.log(`- sessionReportExecutionProfiles=${formatRecordCounts(result.evidence.sessionReportExecutionProfiles)}`);
  console.log(`- sessionReportDiffStats=${formatDiffStats(result.evidence.sessionReportDiffStats)}`);
  console.log(`- sessionReportFileSummaries=${formatDiffFileSummaryList(result.evidence.sessionReportFileSummaries)}`);
  console.log(`- sessionResultOutcome=${result.evidence.sessionResultOutcome ?? "-"}`);
  console.log(`- sessionResultRecovered=${result.evidence.sessionResultRecovered}`);
  console.log(`- sessionResultCommandsFinished=${result.evidence.sessionResultCommandsFinished}`);
  console.log(`- sessionResultTimedOutCommands=${result.evidence.sessionResultTimedOutCommands}`);
  console.log(`- sessionResultExecutionProfiles=${formatRecordCounts(result.evidence.sessionResultExecutionProfiles)}`);
  console.log(`- sessionResultDiffStats=${formatDiffStats(result.evidence.sessionResultDiffStats)}`);
  console.log(`- sessionResultFileSummaries=${formatDiffFileSummaryList(result.evidence.sessionResultFileSummaries)}`);
  console.log(`- sessionResultChangedPaths=${result.evidence.sessionResultChangedPaths.join(",") || "-"}`);
  console.log(`- sessionTimelineItems=${result.evidence.sessionTimelineReturnedItems}/${result.evidence.sessionTimelineItems}`);
  console.log(`- sessionTimelineKinds=${formatRecordCounts(result.evidence.sessionTimelineKinds)}`);
  console.log(`- sessionStatusOutcome=${result.evidence.sessionStatusOutcome ?? "-"}`);
  console.log(`- sessionStatusTimelineItems=${result.evidence.sessionStatusTimelineItems}`);
  console.log(`- sessionListReturned=${result.evidence.sessionListReturned}`);
  console.log(`- sessionListOutcome=${result.evidence.sessionListOutcome ?? "-"}`);
  console.log(`- sessionListPendingApprovals=${result.evidence.sessionListPendingApprovals}`);
  console.log(`- sessionReviewState=${result.evidence.sessionReviewState ?? "-"}`);
  console.log(`- sessionReviewChecklist=${Object.entries(result.evidence.sessionReviewChecklist).map(([key, value]) => `${key}:${value}`).join(",") || "-"}`);
  console.log(`- sessionReviewChangedPaths=${result.evidence.sessionReviewChangedPaths.join(",") || "-"}`);
  console.log(`- sessionReviewPatches=${result.evidence.sessionReviewPatches}`);
  console.log(`- sessionReviewDiffStats=${formatDiffStats(result.evidence.sessionReviewDiffStats)}`);
  console.log(`- sessionReviewFileSummaries=${formatDiffFileSummaryList(result.evidence.sessionReviewFileSummaries)}`);
  console.log(`- sessionReviewTimelineItems=${result.evidence.sessionReviewTimelineItems}`);
  console.log(`- sessionVerificationStatus=${result.evidence.sessionVerificationStatus ?? "-"}`);
  console.log(`- sessionVerificationChecks=${result.evidence.sessionVerificationChecks}`);
  console.log(`- sessionBundleVerificationStatus=${result.evidence.sessionBundleVerificationStatus ?? "-"}`);
  console.log(`- sessionBundleSections=${result.evidence.sessionBundleSections.join(",") || "-"}`);
  console.log(`- sessionBundleOutputBytes=${result.evidence.sessionBundleOutputBytes}`);
  console.log(`- timeoutCommandTimedOut=${result.evidence.timeoutCommandTimedOut}`);
  console.log(`- runSessionId=${result.evidence.runSessionId ?? "-"}`);
  console.log(`- runSessionOutcome=${result.evidence.runSessionOutcome ?? "-"}`);
  console.log(`- runSessionToolResults=${result.evidence.runSessionToolResults}`);
  console.log(`- runSessionVerificationStatus=${result.evidence.runSessionVerificationStatus ?? "-"}`);
  console.log(`- agentRepairWorkspace=${result.evidence.agentRepairWorkspace ?? "-"}`);
  console.log(`- agentRepairSessionId=${result.evidence.agentRepairSessionId ?? "-"}`);
  console.log(`- agentRepairOutcome=${result.evidence.agentRepairOutcome ?? "-"}`);
  console.log(`- agentRepairRecovered=${result.evidence.agentRepairRecovered}`);
  console.log(`- agentRepairVerificationStatus=${result.evidence.agentRepairVerificationStatus ?? "-"}`);
  console.log(`- agentRepairCommandsFinished=${result.evidence.agentRepairCommandsFinished} failed=${result.evidence.agentRepairFailedCommands}`);
  console.log(`- agentRepairFileChanges=${result.evidence.agentRepairFileChanges}`);
  console.log(`- agentRepairPatches=${result.evidence.agentRepairPatches}`);
  console.log(`- agentRepairToolResults=${result.evidence.agentRepairToolResults}`);
  console.log(`- agentRepairChangedPaths=${result.evidence.agentRepairChangedPaths.join(",") || "-"}`);
  console.log(`- resumeSessionId=${result.evidence.resumeSessionId ?? "-"}`);
  console.log(`- resumeOutcome=${result.evidence.resumeOutcome ?? "-"}`);
  console.log(`- resumeVerificationStatus=${result.evidence.resumeVerificationStatus ?? "-"}`);
  console.log(`- resumeToolResults=${result.evidence.resumeToolResults}`);
  console.log(`- resumeAuditEvents=${result.evidence.resumeAuditEvents}`);
  console.log(
    `- queuedApprovalContinuation=session:${result.evidence.queuedApprovalSessionId ?? "-"},worker:${result.evidence.queuedApprovalWorkerId ?? "-"},` +
    `assignment:${result.evidence.queuedApprovalAssignmentId ?? "-"},outcome:${result.evidence.queuedApprovalOutcome ?? "-"},completed:${result.evidence.queuedApprovalCompleted}`,
  );
  console.log(`- queuedApprovalFileChanges=${result.evidence.queuedApprovalFileChanges}`);
  console.log(`- queuedApprovalToolResults=${result.evidence.queuedApprovalToolResults}`);
  console.log(`- queuedApprovalAuditEvents=${result.evidence.queuedApprovalAuditEvents}`);
  console.log(`- targetModeWorkspace=${result.evidence.targetModeWorkspace ?? "-"}`);
  console.log(`- targetModeSessions=${result.evidence.targetModeSessions.map((entry) => `${entry.mode}:${entry.outcome ?? "-"}:${entry.verificationStatus ?? "-"}`).join(",") || "-"}`);
  console.log(`- lifecycleAuditEvents=${result.evidence.lifecycleAuditEvents}`);
  console.log(`- lifecycleStatuses=pause:${result.evidence.pauseStatus ?? "-"},resume:${result.evidence.resumeStatus ?? "-"},cancel:${result.evidence.cancelStatus ?? "-"}`);
  if (result.commands.inspectSession) {
    console.log("");
    console.log("Inspect:");
    console.log(`- ${result.commands.inspectSession}`);
    console.log(`- ${result.commands.changes}`);
    console.log(`- ${result.commands.audit}`);
    console.log(`- ${result.commands.sessionDiff}`);
    console.log(`- ${result.commands.sessionReport}`);
    console.log(`- ${result.commands.sessionStatus}`);
    console.log(`- ${result.commands.sessionTimeline}`);
    console.log(`- ${result.commands.sessionReview}`);
    console.log(`- ${result.commands.sessionResult}`);
    console.log(`- ${result.commands.sessionVerify}`);
    console.log(`- ${result.commands.sessionBundle}`);
    console.log(`- ${result.commands.runJson}`);
    if (result.commands.agentRepairResult) {
      console.log(`- ${result.commands.agentRepairResult}`);
    }
    if (result.commands.agentRepairVerify) {
      console.log(`- ${result.commands.agentRepairVerify}`);
    }
    if (result.commands.resumeResult) {
      console.log(`- ${result.commands.resumeResult}`);
    }
    if (result.commands.targetModeResult) {
      console.log(`- ${result.commands.targetModeResult}`);
    }
  }
}

async function runPhaseTwoLifecycleSmoke(platform: Awaited<ReturnType<typeof createLocalPlatform>>, actor: ReturnType<typeof localUserActor>) {
  const pauseSession = await platform.store.createSession({
    objective: "Phase 2 lifecycle smoke: pause and resume a supervised engineering task.",
    targetMode: "build",
    status: "running",
    risk: "medium",
    createdBy: actor,
  });
  const paused = await platform.tasks.pause({
    sessionId: pauseSession.id,
    actor,
    reason: "phase2 smoke pause",
  });
  const resumed = await platform.tasks.markResumed({
    sessionId: pauseSession.id,
    actor,
    reason: "phase2 smoke resume",
  });

  const cancelSession = await platform.store.createSession({
    objective: "Phase 2 lifecycle smoke: cancel a supervised engineering task.",
    targetMode: "build",
    status: "running",
    risk: "medium",
    createdBy: actor,
  });
  const cancelled = await platform.tasks.cancel({
    sessionId: cancelSession.id,
    actor,
    reason: "phase2 smoke cancel",
  });

  const sessionIds = [pauseSession.id, cancelSession.id].map((id) => String(id));
  const auditEvents = await platform.store.listAuditEvents({ limit: 200 });
  const lifecycleEvents = auditEvents.filter((event) =>
    sessionIds.includes(event.sessionId ?? "") &&
    (event.type === "session.paused" || event.type === "session.resumed" || event.type === "session.cancelled")
  );
  const eventTypes = new Set(lifecycleEvents.map((event) => event.type));
  return {
    ok:
      paused.status === "paused" &&
      resumed.status === "running" &&
      cancelled.status === "cancelled" &&
      eventTypes.has("session.paused") &&
      eventTypes.has("session.resumed") &&
      eventTypes.has("session.cancelled"),
    pauseStatus: paused.status,
    resumeStatus: resumed.status,
    cancelStatus: cancelled.status,
    auditEvents: lifecycleEvents.length,
    sessionIds,
  };
}

async function runPhaseTwoResumeSmoke(platform: Awaited<ReturnType<typeof createLocalPlatform>>, actor: ReturnType<typeof localUserActor>) {
  const session = await platform.store.createSession({
    objective: "Phase 2 resume smoke: continue a paused engineering task.",
    targetMode: "build",
    status: "paused",
    risk: "medium",
    createdBy: actor,
  });
  await platform.store.appendMessage({
    sessionId: session.id,
    message: { role: "system", content: "Mock resume smoke system prompt." },
  });
  await platform.store.appendMessage({
    sessionId: session.id,
    message: { role: "user", content: "inspect this workspace after resume" },
  });

  const finalAnswer = await platform.agent.resume(session.id);
  const result = await buildSessionResult(platform.store, session.id);
  const verification = await buildSessionVerification(platform.store, session.id, {
    requireCommand: false,
  });
  const auditEvents = await platform.store.listAuditEvents({ sessionId: session.id, limit: 100 });
  return {
    sessionId: session.id,
    finalAnswer,
    outcome: result.summary.outcome,
    verificationStatus: verification.status,
    toolResults: result.summary.toolResults,
    auditEvents: auditEvents.filter((event) => event.type === "session.resumed").length,
  };
}

async function runPhaseTwoQueuedApprovalContinuationSmoke(platform: Awaited<ReturnType<typeof createLocalPlatform>>, actor: ReturnType<typeof localUserActor>) {
  const session = await platform.store.createSession({
    objective: "Phase 2 queued approval smoke: replay an approved write and resume through a worker.",
    targetMode: "build",
    status: "paused",
    risk: "medium",
    createdBy: actor,
  });
  await platform.store.appendMessage({
    sessionId: session.id,
    message: { role: "system", content: "Mock queued approval continuation smoke system prompt." },
  });
  await platform.store.appendMessage({
    sessionId: session.id,
    message: { role: "user", content: "inspect this workspace after queued approval continuation" },
  });

  const worker = await platform.workers.register({
    actor,
    agentId: platform.localAgent.id,
    machineId: platform.localAgent.machineId,
    displayName: "Phase 2 queued approval worker",
    capabilities: ["workspace.exec"],
    maxConcurrentTasks: 1,
    ttlSeconds: 60,
  });
  const approvalId = makeId<"ArtifactId">("appr");
  const pendingToolCallId = makeId<"ToolCallId">("pending_tool");
  const now = new Date().toISOString();
  await platform.store.createApprovalRequest({
    id: approvalId,
    status: "pending",
    requestedBy: actor,
    action: "workspace.write",
    reason: "Phase 2 queued approval continuation smoke",
    sessionId: session.id,
    toolName: "create_file",
    inputSummary: "{\"path\":\"queued-approval.txt\"}",
    createdAt: now,
  });
  await platform.store.createPendingToolCall({
    id: pendingToolCallId,
    approvalId,
    toolCallId: "phase2-queued-create",
    sessionId: session.id,
    toolName: "create_file",
    input: {
      path: "queued-approval.txt",
      content: "queued approval continuation\n",
      overwrite: true,
    },
    requestedBy: actor,
    status: "pending_approval",
    createdAt: now,
    updatedAt: now,
  });
  await platform.store.decideApproval({
    approvalId,
    status: "approved",
    decidedBy: actor,
    decisionReason: "phase2 smoke queued continuation",
  });

  const { createWorkspaceTools } = await import("../tools/workspace-tools.js");
  const { replayApprovedTool } = await import("../tools/tool-replay.js");
  const replay = await replayApprovedTool({
    approvalId,
    store: platform.store,
    actor,
    tools: createWorkspaceTools(platform.workspace, {
      store: platform.store,
      locks: platform.locks,
      actor,
      sessionId: session.id,
    }),
  });
  const assignment = replay.ok
    ? await platform.taskBroker.enqueue({
        actor,
        workerId: worker.id,
        sessionId: session.id,
        metadata: {
          continuation: "approval_resume",
          approvalId,
          pendingToolCallId,
          toolName: "create_file",
        },
      })
    : undefined;
  const run = assignment
    ? await platform.workerRunner.runOnce({
        workerId: worker.id,
        actor,
        leaseTtlSeconds: 60,
      })
    : undefined;
  const result = await buildSessionResult(platform.store, session.id);
  const auditEvents = await platform.store.listAuditEvents({ sessionId: session.id, limit: 100 });
  const fileChanges = await platform.store.listFileChanges(session.id);
  return {
    sessionId: session.id,
    workerId: worker.id,
    assignmentId: assignment?.id,
    outcome: result.summary.outcome,
    completed: run?.ran === true && run.completed && result.summary.outcome === "succeeded",
    replayOk: replay.ok,
    fileChanges: fileChanges.length,
    toolResults: result.summary.toolResults,
    auditEvents: auditEvents.filter((event) => event.type === "task.assigned" || event.type === "task.completed" || event.type === "tool.completed").length,
  };
}

async function runPhaseTwoTargetModeSmoke(cwd: string, options: { cleanup?: boolean } = {}) {
  const workspace = path.join(cwd, ".agent", "tmp", `phase2-target-modes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "README.md"), "# Phase 2 Target Mode Smoke\n", "utf8");
  const modes: Array<"plan" | "build" | "goal"> = ["plan", "build", "goal"];
  const sessions: Array<{
    mode: "plan" | "build" | "goal";
    targetMode?: string;
    sessionId?: string;
    outcome?: string;
    verificationStatus?: string;
    toolResults: number;
    commandsFinished: number;
  }> = [];
  try {
    for (const mode of modes) {
      const platform = await createLocalPlatform(workspace, {
        provider: "mock",
        targetMode: mode,
      });
      try {
        const run = await platform.agent.runWithSession(`phase2 ${mode} target mode smoke`);
        const session = run.session ? (await platform.store.getSession(run.session.id)) ?? run.session : undefined;
        const result = session ? await buildSessionResult(platform.store, session.id) : undefined;
        const verification = session
          ? await buildSessionVerification(platform.store, session.id, {
              requireCommand: false,
            })
          : undefined;
        sessions.push({
          mode,
          targetMode: session?.targetMode,
          sessionId: session?.id,
          outcome: result?.summary.outcome,
          verificationStatus: verification?.status,
          toolResults: result?.summary.toolResults ?? 0,
          commandsFinished: result?.summary.commandsFinished ?? 0,
        });
      } finally {
        platform.locks.close?.();
        platform.store.close();
      }
    }
    return { workspace, sessions };
  } finally {
    if (options.cleanup) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
}

async function runPhaseTwoAgentRepairSmoke(cwd: string, options: { cleanup?: boolean } = {}) {
  const workspace = path.join(cwd, ".agent", "tmp", `phase2-agent-repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await createPhaseTwoSampleWorkspace(workspace);
  const platform = await createLocalPlatform(workspace, {
    provider: "mock",
  });
  try {
    const run = await platform.agent.runWithSession("repair failing sample test using the available test command and patch tool");
    const session = run.session ? (await platform.store.getSession(run.session.id)) ?? run.session : undefined;
    const result = session ? await buildSessionResult(platform.store, session.id) : undefined;
    const verification = session
      ? await buildSessionVerification(platform.store, session.id, {
          requireChange: true,
          requirePatch: true,
          requireRecovery: true,
        })
      : undefined;
    return {
      workspace,
      sessionId: session?.id,
      finalAnswer: run.finalAnswer,
      outcome: result?.summary.outcome,
      recovered: result?.summary.recovered ?? false,
      verificationStatus: verification?.status,
      commandsFinished: result?.summary.commandsFinished ?? 0,
      failedCommands: result?.summary.failedCommands ?? 0,
      fileChanges: result?.summary.fileChanges ?? 0,
      patches: result?.summary.patches ?? 0,
      toolResults: result?.summary.toolResults ?? 0,
      changedPaths: result?.summary.changedPaths ?? [],
    };
  } finally {
    platform.locks.close?.();
    platform.store.close();
    if (options.cleanup) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
}

async function createPhaseTwoSampleWorkspace(sampleWorkspace: string): Promise<void> {
  await fs.mkdir(path.join(sampleWorkspace, "src"), { recursive: true });
  await fs.mkdir(path.join(sampleWorkspace, "test"), { recursive: true });
  await fs.writeFile(
    path.join(sampleWorkspace, "package.json"),
    `${JSON.stringify({ name: "soloclaw-phase2-smoke", version: "0.0.0", type: "module", scripts: { test: "node test/math.test.js" } }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(sampleWorkspace, "src", "math.js"),
    "export function add(a, b) {\n  return a - b;\n}\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(sampleWorkspace, "test", "math.test.js"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { add } from "../src/math.js";',
      "",
      'test("adds two numbers", () => {',
      "  assert.equal(add(2, 3), 5);",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

function phaseTwoSamplePatch(): string {
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

function requiredTool(tools: Array<{ name: string; handler: (input: Record<string, unknown>) => Promise<ToolResult> }>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Required tool is not registered: ${name}`);
  }
  return tool;
}

function toolOutputExitCode(output?: string): number | null | undefined {
  const match = output?.match(/^exit=(-?\d+|null)$/m);
  if (!match) {
    return undefined;
  }
  return match[1] === "null" ? null : Number(match[1]);
}

function toolOutputTimedOut(output?: string): boolean {
  return /^timedOut=true$/m.test(output ?? "");
}

function patchToolSummary(output?: string): string {
  if (!output) {
    return "patch applied";
  }
  try {
    const parsed = JSON.parse(output) as { summary?: string };
    return parsed.summary ?? "patch applied";
  } catch {
    return output.length > 160 ? `${output.slice(0, 160)}\n[truncated]` : output;
  }
}

function toolOutputExcerpt(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }
  return output.length > 1000 ? `${output.slice(0, 1000)}\n[truncated]` : output;
}

async function buildSessionReport(store: AgentStore, sessionId: string) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const messages = await store.getMessages(sessionId);
  const toolResults = await store.getToolResults(sessionId);
  const fileChanges = await store.listFileChanges(sessionId);
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 100 });
  const approvals = (await store.listApprovalRequests())
    .filter((approval) => approval.sessionId === sessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const commandEvents = auditEvents
    .filter((event) => event.type === "command.started" || event.type === "command.finished")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const finishedCommands = commandEvents.filter((event) => event.type === "command.finished");
  const failedCommands = finishedCommands.filter((event) =>
    commandTimedOut(event.metadata) ||
    (commandExitCode(event.metadata) !== undefined && commandExitCode(event.metadata) !== 0)
  );
  const timedOutCommands = finishedCommands.filter((event) => commandTimedOut(event.metadata));
  const executionProfiles = commandExecutionProfileCounts(finishedCommands);
  const failedToolResults = toolResults.filter((result) => !result.ok);
  const changedPaths = [...new Set(fileChanges.map((change) => change.path))].sort();
  const patchDiffs = sessionPatchAuditEvents(auditEvents).map((event, index) => {
    const patch = auditPatchInput(event.metadata);
    return {
      ordinal: index + 1,
      patch,
      stats: summarizeUnifiedDiffPatch(patch),
    };
  });
  const diffStats = mergeDiffStats(patchDiffs.map((patch) => patch.stats));
  const fileSummaries = summarizeDiffFileSummaries(patchDiffs);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const approvedApprovals = approvals.filter((approval) => approval.status === "approved");
  const deniedApprovals = approvals.filter((approval) => approval.status === "denied");

  return {
    generatedAt: new Date().toISOString(),
    session,
    summary: {
      messages: messages.length,
      toolResults: toolResults.length,
      failedToolResults: failedToolResults.length,
      fileChanges: fileChanges.length,
      changedPaths,
      commandEvents: commandEvents.length,
      commandsFinished: finishedCommands.length,
      failedCommands: failedCommands.length,
      timedOutCommands: timedOutCommands.length,
      executionProfiles,
      diffStats,
      fileSummaries,
      approvals: approvals.length,
      pendingApprovals: pendingApprovals.length,
      approvedApprovals: approvedApprovals.length,
      deniedApprovals: deniedApprovals.length,
      auditEvents: auditEvents.length,
    },
    approvals: approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      action: approval.action,
      toolName: approval.toolName,
      approverHint: approval.approverHint,
      reason: approval.reason,
      createdAt: approval.createdAt,
      decidedAt: approval.decidedAt,
    })),
    fileChanges,
    commandEvents: commandEvents.map((event) => ({
      type: event.type,
      createdAt: event.createdAt,
      summary: event.summary,
      command: typeof event.metadata?.command === "string" ? event.metadata.command : undefined,
      exitCode: commandExitCode(event.metadata),
      timedOut: commandTimedOut(event.metadata),
      durationMs: commandDurationMs(event.metadata),
      executionProfile: commandExecutionProfileName(event.metadata),
      stdoutBytes: typeof event.metadata?.stdoutBytes === "number" ? event.metadata.stdoutBytes : undefined,
      stderrBytes: typeof event.metadata?.stderrBytes === "number" ? event.metadata.stderrBytes : undefined,
    })),
    toolResults: toolResults.map((result) => ({
      callId: result.callId,
      ok: result.ok,
      error: result.error,
      outputExcerpt: toolOutputExcerpt(result.output),
      truncated: result.truncated,
    })),
    recentAuditEvents: auditEvents.slice(0, 20).map((event) => ({
      type: event.type,
      actor: event.actor,
      summary: event.summary,
      createdAt: event.createdAt,
    })),
  };
}

function printSessionReport(report: Awaited<ReturnType<typeof buildSessionReport>>): void {
  console.log(`Session report: ${report.session.id}`);
  console.log(`status=${report.session.status}\ttarget=${report.session.targetMode}\trisk=${report.session.risk}\tupdated=${report.session.updatedAt}`);
  console.log(`objective: ${report.session.objective}`);
  console.log("");
  console.log("Summary:");
  console.log(`- messages=${report.summary.messages}`);
  console.log(`- toolResults=${report.summary.toolResults} failed=${report.summary.failedToolResults}`);
  console.log(`- fileChanges=${report.summary.fileChanges} paths=${report.summary.changedPaths.length}`);
  console.log(`- commandsFinished=${report.summary.commandsFinished} failed=${report.summary.failedCommands} timedOut=${report.summary.timedOutCommands}`);
  console.log(`- executionProfiles=${formatRecordCounts(report.summary.executionProfiles)}`);
  console.log(`- diffStats=${formatDiffStats(report.summary.diffStats)}`);
  console.log(`- fileSummaries=${formatDiffFileSummaryList(report.summary.fileSummaries)}`);
  console.log(`- approvals=${report.summary.approvals} pending=${report.summary.pendingApprovals}`);
  console.log(`- auditEvents=${report.summary.auditEvents}`);
  if (report.fileChanges.length > 0) {
    console.log("");
    console.log("File changes:");
    for (const change of report.fileChanges) {
      console.log(`- ${change.kind}\t${change.path}\t${change.summary}`);
    }
  }
  if (report.commandEvents.length > 0) {
    console.log("");
    console.log("Commands:");
    for (const event of report.commandEvents) {
      const exit = event.exitCode === undefined ? "" : ` exit=${event.exitCode}`;
      const profile = event.executionProfile ? ` profile=${event.executionProfile}` : "";
      console.log(`- ${event.type}${exit}${profile}\t${event.command ?? event.summary}`);
    }
  }
  if (report.toolResults.length > 0) {
    console.log("");
    console.log("Tool results:");
    for (const result of report.toolResults) {
      const status = result.ok ? "ok" : "failed";
      const detail = result.error?.message ?? singleLine(result.outputExcerpt ?? "");
      console.log(`- ${result.callId}\t${status}\t${detail}`);
    }
  }
  if (report.approvals.length > 0) {
    console.log("");
    console.log("Approvals:");
    for (const approval of report.approvals) {
      console.log(`- ${approval.status}\t${approval.action}\t${approval.toolName ?? "-"}\t${approval.reason}`);
    }
  }
  if (report.recentAuditEvents.length > 0) {
    console.log("");
    console.log("Recent audit:");
    for (const event of report.recentAuditEvents.slice(0, 8)) {
      console.log(`- ${event.createdAt}\t${event.type}\t${event.summary}`);
    }
  }
}

type SessionTimelineItemKind = "audit" | "file_change" | "approval" | "approval_decision";

type SessionTimelineItem = {
  ordinal: number;
  kind: SessionTimelineItemKind;
  createdAt: string;
  sourceId: string;
  actor?: string;
  title: string;
  summary: string;
  status?: string;
  action?: string;
  toolName?: string;
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  executionProfile?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

async function buildSessionTimeline(store: AgentStore, sessionId: string, options: { limit?: number } = {}) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const messages = await store.getMessages(sessionId);
  const toolResults = await store.getToolResults(sessionId);
  const fileChanges = await store.listFileChanges(sessionId);
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 1000 });
  const approvals = (await store.listApprovalRequests())
    .filter((approval) => approval.sessionId === sessionId);

  const unnumbered: Omit<SessionTimelineItem, "ordinal">[] = [];
  for (const event of auditEvents) {
    unnumbered.push(timelineItemFromAudit(event));
  }
  for (const change of fileChanges) {
    unnumbered.push(timelineItemFromFileChange(change));
  }
  for (const approval of approvals) {
    unnumbered.push(timelineItemFromApproval(approval));
    if (approval.decidedAt) {
      unnumbered.push(timelineItemFromApprovalDecision(approval));
    }
  }

  const allItems = unnumbered
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || timelineKindOrder(left.kind) - timelineKindOrder(right.kind) || left.sourceId.localeCompare(right.sourceId))
    .map((item, index) => ({ ordinal: index + 1, ...item }));
  const limit = options.limit ?? allItems.length;
  const items = allItems.slice(Math.max(0, allItems.length - limit));
  const byKind = countTimelineKinds(allItems);

  return {
    generatedAt: new Date().toISOString(),
    session,
    summary: {
      totalItems: allItems.length,
      returnedItems: items.length,
      messages: messages.length,
      toolResults: toolResults.length,
      auditEvents: auditEvents.length,
      fileChanges: fileChanges.length,
      approvals: approvals.length,
      byKind,
      earliestAt: allItems.at(0)?.createdAt,
      latestAt: allItems.at(-1)?.createdAt,
    },
    items,
  };
}

async function buildSessionStatus(store: AgentStore, sessionId: string, options: { limit?: number } = {}) {
  const result = await buildSessionResult(store, sessionId);
  const timeline = await buildSessionTimeline(store, sessionId, { limit: options.limit ?? 8 });
  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      changedPaths: result.summary.changedPaths,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      executionProfiles: result.summary.executionProfiles,
      diffStats: result.summary.diffStats,
      fileSummaries: result.summary.fileSummaries,
      pendingApprovals: result.summary.pendingApprovals,
      toolResults: result.summary.toolResults,
      failedToolResults: result.summary.failedToolResults,
      lastCommand: result.summary.lastCommand,
      timelineItems: timeline.summary.totalItems,
      latestAt: timeline.summary.latestAt,
    },
    latestTimeline: timeline.items,
    reviewCommands: {
      timeline: `agent session timeline ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
    },
  };
}

type SessionListOptions = {
  limit?: number;
  status?: "created" | "running" | "paused" | "cancelled" | "failed" | "completed";
  targetMode?: "plan" | "build" | "goal";
  json?: boolean;
};

async function buildSessionList(store: AgentStore, options: SessionListOptions = {}) {
  const limit = options.limit ?? 20;
  const scanLimit = options.status || options.targetMode ? Math.max(limit * 5, 50) : limit;
  const scanned = await store.listSessions(scanLimit);
  const filtered = scanned
    .filter((session) => !options.status || session.status === options.status)
    .filter((session) => !options.targetMode || session.targetMode === options.targetMode)
    .slice(0, limit);
  const sessions = [];
  for (const session of filtered) {
    const status = await buildSessionStatus(store, session.id, { limit: 3 });
    sessions.push({
      session: status.session,
      summary: status.summary,
      latestTimeline: status.latestTimeline,
      reviewCommands: status.reviewCommands,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      scanned: scanned.length,
      returned: sessions.length,
      limit,
      filters: {
        status: options.status,
        targetMode: options.targetMode,
      },
      byStatus: countSessionListBy(sessions, (entry) => entry.session.status),
      byOutcome: countSessionListBy(sessions, (entry) => entry.summary.outcome),
      pendingApprovals: sessions.reduce((total, entry) => total + entry.summary.pendingApprovals, 0),
      changedSessions: sessions.filter((entry) => entry.summary.changedPaths.length > 0).length,
    },
    sessions,
  };
}

function printSessionList(list: Awaited<ReturnType<typeof buildSessionList>>): void {
  console.log("Session dashboard:");
  console.log(
    `returned=${list.summary.returned}/${list.summary.scanned}\tlimit=${list.summary.limit}\t` +
    `status=${list.summary.filters.status ?? "-"}\ttarget=${list.summary.filters.targetMode ?? "-"}`,
  );
  console.log(
    `byStatus=${formatRecordCounts(list.summary.byStatus)}\tbyOutcome=${formatRecordCounts(list.summary.byOutcome)}\t` +
    `pendingApprovals=${list.summary.pendingApprovals}\tchangedSessions=${list.summary.changedSessions}`,
  );
  if (list.sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }
  for (const entry of list.sessions) {
    const changed = entry.summary.changedPaths.length > 0 ? entry.summary.changedPaths.join(",") : "-";
    console.log("");
    console.log(
      `${entry.session.id}\t${entry.session.targetMode}\t${entry.session.status}\toutcome=${entry.summary.outcome}\t` +
      `pending=${entry.summary.pendingApprovals}\tcommands=${entry.summary.commandsFinished}/${entry.summary.failedCommands}\t` +
      `changes=${changed}\tupdated=${entry.session.updatedAt}`,
    );
    console.log(`objective: ${entry.session.objective}`);
    console.log(`review: ${entry.reviewCommands.review}`);
    console.log(`result: ${entry.reviewCommands.result}`);
  }
}

function countSessionListBy<T>(entries: T[], keyFn: (entry: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const key = keyFn(entry) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function buildSessionEvidenceBundle(
  store: AgentStore,
  sessionId: string,
  options: SessionVerificationOptions & { limit?: number } = {},
) {
  const diff = await buildSessionDiff(store, sessionId);
  const report = await buildSessionReport(store, sessionId);
  const result = await buildSessionResult(store, sessionId);
  const timeline = await buildSessionTimeline(store, sessionId, { limit: options.limit ?? 25 });
  const status = await buildSessionStatus(store, sessionId, { limit: options.limit ?? 8 });
  const review = await buildSessionReview(store, sessionId, { limit: options.limit ?? 12 });
  const verification = await buildSessionVerification(store, sessionId, options);

  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      reviewState: review.summary.reviewState,
      verificationStatus: verification.status,
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      diffStats: result.summary.diffStats,
      fileSummaries: result.summary.fileSummaries,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      executionProfiles: result.summary.executionProfiles,
      approvals: result.summary.approvals,
      pendingApprovals: result.summary.pendingApprovals,
      toolResults: result.summary.toolResults,
      failedToolResults: result.summary.failedToolResults,
      timelineItems: timeline.summary.totalItems,
      returnedTimelineItems: timeline.summary.returnedItems,
    },
    sections: {
      diff,
      report,
      status,
      timeline,
      review,
      result,
      verification,
    },
    reviewCommands: {
      bundle: `agent session bundle ${sessionId} --json`,
      diff: `agent session diff ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      status: `agent session status ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
      verify: `agent session verify ${sessionId}`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

async function writeJsonOutputInsideWorkspace(cwd: string, outputPath: string, value: unknown): Promise<{ path: string; bytes: number }> {
  const resolved = path.resolve(cwd, outputPath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("--output must stay inside the current workspace.");
  }
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
  return { path: resolved, bytes: Buffer.byteLength(content, "utf8") };
}

function printSessionEvidenceBundle(bundle: Awaited<ReturnType<typeof buildSessionEvidenceBundle>> & { output?: { path: string; bytes: number } }): void {
  console.log(`Session bundle: ${bundle.session.id}`);
  console.log(
    `outcome=${bundle.summary.outcome}\tverification=${bundle.summary.verificationStatus}\t` +
    `reviewState=${bundle.summary.reviewState}\tstatus=${bundle.summary.status}`,
  );
  console.log(`objective: ${bundle.session.objective}`);
  console.log("");
  console.log("Summary:");
  console.log(`- changedPaths=${bundle.summary.changedPaths.join(",") || "-"}`);
  console.log(`- fileChanges=${bundle.summary.fileChanges} patches=${bundle.summary.patches} diffStats=${formatDiffStats(bundle.summary.diffStats)}`);
  console.log(`- fileSummaries=${formatDiffFileSummaryList(bundle.summary.fileSummaries)}`);
  console.log(`- commandsFinished=${bundle.summary.commandsFinished} failed=${bundle.summary.failedCommands} timedOut=${bundle.summary.timedOutCommands}`);
  console.log(`- executionProfiles=${formatRecordCounts(bundle.summary.executionProfiles)}`);
  console.log(`- approvals=${bundle.summary.approvals} pending=${bundle.summary.pendingApprovals}`);
  console.log(`- timeline=${bundle.summary.returnedTimelineItems}/${bundle.summary.timelineItems}`);
  console.log(`- verificationChecks=${bundle.sections.verification.checks.length}`);
  if (bundle.output) {
    console.log(`- output=${bundle.output.path} bytes=${bundle.output.bytes}`);
  }
  console.log("");
  console.log("Sections:");
  console.log("- diff");
  console.log("- report");
  console.log("- status");
  console.log("- timeline");
  console.log("- review");
  console.log("- result");
  console.log("- verification");
  console.log("");
  console.log("Review:");
  console.log(`- ${bundle.reviewCommands.bundle}`);
  console.log(`- ${bundle.reviewCommands.review}`);
  console.log(`- ${bundle.reviewCommands.diff}`);
  console.log(`- ${bundle.reviewCommands.result}`);
  console.log(`- ${bundle.reviewCommands.verify}`);
}

function printSessionTimeline(timeline: Awaited<ReturnType<typeof buildSessionTimeline>>): void {
  console.log(`Session timeline: ${timeline.session.id}`);
  console.log(`status=${timeline.session.status}\ttarget=${timeline.session.targetMode}\trisk=${timeline.session.risk}`);
  console.log(`items=${timeline.summary.returnedItems}/${timeline.summary.totalItems}\tmessages=${timeline.summary.messages}\ttoolResults=${timeline.summary.toolResults}`);
  console.log(`byKind=${formatRecordCounts(timeline.summary.byKind)}`);
  console.log("");
  for (const item of timeline.items) {
    const details = [
      item.status ? `status=${item.status}` : undefined,
      item.action ? `action=${item.action}` : undefined,
      item.toolName ? `tool=${item.toolName}` : undefined,
      item.exitCode !== undefined ? `exit=${item.exitCode ?? "-"}` : undefined,
      item.timedOut ? "timedOut=true" : undefined,
      item.executionProfile ? `profile=${item.executionProfile}` : undefined,
      item.path ? `path=${item.path}` : undefined,
    ].filter(Boolean).join(" ");
    console.log(`${item.ordinal}. ${item.createdAt}\t${item.kind}\t${item.title}${details ? `\t${details}` : ""}`);
    if (item.summary) {
      console.log(`   ${item.summary}`);
    }
  }
}

function printSessionStatus(status: Awaited<ReturnType<typeof buildSessionStatus>>): void {
  console.log(`Session status: ${status.session.id}`);
  console.log(
    `outcome=${status.summary.outcome}\tstatus=${status.summary.status}\ttarget=${status.summary.targetMode}\t` +
    `recovered=${status.summary.recovered ? "yes" : "no"}`,
  );
  console.log(`objective: ${status.session.objective}`);
  console.log("");
  console.log("Summary:");
  console.log(`- changedPaths=${status.summary.changedPaths.length ? status.summary.changedPaths.join(",") : "-"}`);
  console.log(`- commandsFinished=${status.summary.commandsFinished} failed=${status.summary.failedCommands} timedOut=${status.summary.timedOutCommands}`);
  console.log(`- executionProfiles=${formatRecordCounts(status.summary.executionProfiles)}`);
  console.log(`- diffStats=${formatDiffStats(status.summary.diffStats)}`);
  console.log(`- fileSummaries=${formatDiffFileSummaryList(status.summary.fileSummaries)}`);
  console.log(`- pendingApprovals=${status.summary.pendingApprovals}`);
  console.log(`- toolResults=${status.summary.toolResults} failed=${status.summary.failedToolResults}`);
  console.log(`- timelineItems=${status.summary.timelineItems} latestAt=${status.summary.latestAt ?? "-"}`);
  if (status.latestTimeline.length > 0) {
    console.log("");
    console.log("Latest timeline:");
    for (const item of status.latestTimeline) {
      console.log(`- ${item.createdAt}\t${item.kind}\t${item.title}`);
    }
  }
  console.log("");
  console.log("Review:");
  console.log(`- ${status.reviewCommands.timeline}`);
  console.log(`- ${status.reviewCommands.review}`);
  console.log(`- ${status.reviewCommands.result}`);
  console.log(`- ${status.reviewCommands.report}`);
}

async function buildSessionReview(store: AgentStore, sessionId: string, options: { limit?: number } = {}) {
  const result = await buildSessionResult(store, sessionId);
  const diff = await buildSessionDiff(store, sessionId);
  const timeline = await buildSessionTimeline(store, sessionId, { limit: options.limit ?? 12 });
  const checklist = buildSessionReviewChecklist(result, diff);
  const reviewState = sessionReviewState(result.summary.outcome, result.summary.pendingApprovals, checklist);

  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      reviewState,
      outcome: result.summary.outcome,
      recovered: result.summary.recovered,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      executionProfiles: result.summary.executionProfiles,
      diffStats: result.summary.diffStats,
      fileSummaries: result.summary.fileSummaries,
      pendingApprovals: result.summary.pendingApprovals,
      toolResults: result.summary.toolResults,
      failedToolResults: result.summary.failedToolResults,
      timelineItems: timeline.summary.totalItems,
    },
    checklist,
    changes: {
      changedPaths: result.summary.changedPaths,
      diffStats: diff.summary.diffStats,
      fileChanges: result.fileChanges,
      fileSummaries: diff.summary.fileSummaries,
      patches: diff.patches.map((patch) => ({
        ordinal: patch.ordinal,
        createdAt: patch.createdAt,
        paths: patch.paths,
        stats: patch.stats,
        fileSummaries: patch.fileSummaries,
        hasPatchText: Boolean(patch.patch),
        patchExcerpt: toolOutputExcerpt(patch.patch),
      })),
    },
    commands: result.commands,
    recovery: result.recovery,
    approvals: result.approvals,
    latestTimeline: timeline.items,
    reviewCommands: {
      diff: `agent session diff ${sessionId}`,
      status: `agent session status ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      result: `agent session result ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
      audit: `agent audit list --session ${sessionId}`,
      rawSession: `agent show-session ${sessionId}`,
    },
  };
}

type SessionReviewChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "not_needed";
  summary: string;
};

function buildSessionReviewChecklist(
  result: Awaited<ReturnType<typeof buildSessionResult>>,
  diff: Awaited<ReturnType<typeof buildSessionDiff>>,
): SessionReviewChecklistItem[] {
  const lastCommand = result.summary.lastCommand;
  return [
    {
      id: "change-summary",
      label: "change summary",
      status: result.summary.changedPaths.length > 0 ? "pass" : "warn",
      summary: `${result.summary.changedPaths.length} changed path(s), ${result.summary.fileChanges} file change record(s)`,
    },
    {
      id: "patch-review",
      label: "patch review",
      status: diff.summary.patches > 0 ? "pass" : "warn",
      summary: `${diff.summary.patches} persisted patch(es), ${diff.summary.changedPaths.length} diff path(s), ${formatDiffStats(diff.summary.diffStats)}`,
    },
    {
      id: "command-result",
      label: "command result",
      status: result.summary.commandsFinished === 0
        ? "warn"
        : lastCommand?.exitCode === 0 && !lastCommand.timedOut
          ? "pass"
          : "fail",
      summary: `commands=${result.summary.commandsFinished}, lastExit=${lastCommand?.exitCode ?? "-"}, timedOut=${lastCommand?.timedOut ?? false}`,
    },
    {
      id: "failure-recovery",
      label: "failure recovery",
      status: result.recovery.observedFailure ? result.recovery.recovered ? "pass" : "fail" : "not_needed",
      summary: `observedFailure=${result.recovery.observedFailure}, recovered=${result.recovery.recovered}`,
    },
    {
      id: "approval-state",
      label: "approval state",
      status: result.summary.pendingApprovals > 0 ? "warn" : "pass",
      summary: `${result.summary.pendingApprovals} pending approval request(s)`,
    },
    {
      id: "tool-errors",
      label: "tool errors",
      status: result.summary.failedToolResults === 0 ? "pass" : "fail",
      summary: `${result.summary.failedToolResults} failed tool result(s)`,
    },
  ];
}

function sessionReviewState(
  outcome: string,
  pendingApprovals: number,
  checklist: SessionReviewChecklistItem[],
): "ready" | "needs_attention" | "waiting_for_approval" | "in_progress" {
  if (pendingApprovals > 0) {
    return "waiting_for_approval";
  }
  if (outcome === "in_progress" || outcome === "paused") {
    return "in_progress";
  }
  if (checklist.some((item) => item.status === "fail")) {
    return "needs_attention";
  }
  return "ready";
}

function printSessionReview(review: Awaited<ReturnType<typeof buildSessionReview>>): void {
  console.log(`Session review: ${review.session.id}`);
  console.log(
    `state=${review.summary.reviewState}\toutcome=${review.summary.outcome}\t` +
    `recovered=${review.summary.recovered ? "yes" : "no"}\tstatus=${review.summary.status}`,
  );
  console.log(`objective: ${review.session.objective}`);
  console.log("");
  console.log("Summary:");
  console.log(`- changedPaths=${review.summary.changedPaths.length ? review.summary.changedPaths.join(",") : "-"}`);
  console.log(`- patches=${review.summary.patches} fileChanges=${review.summary.fileChanges}`);
  console.log(`- diffStats=${formatDiffStats(review.summary.diffStats)}`);
  console.log(`- fileSummaries=${formatDiffFileSummaryList(review.summary.fileSummaries)}`);
  console.log(`- commandsFinished=${review.summary.commandsFinished} failed=${review.summary.failedCommands} timedOut=${review.summary.timedOutCommands}`);
  console.log(`- pendingApprovals=${review.summary.pendingApprovals}`);
  console.log(`- timelineItems=${review.summary.timelineItems}`);
  console.log("");
  console.log("Checklist:");
  for (const item of review.checklist) {
    console.log(`- [${item.status}] ${item.label}: ${item.summary}`);
  }
  if (review.changes.changedPaths.length > 0) {
    console.log("");
    console.log("Changed paths:");
    for (const changedPath of review.changes.changedPaths) {
      console.log(`- ${changedPath}`);
    }
  }
  if (review.changes.fileSummaries.length > 0) {
    console.log("");
    console.log("File summary:");
    for (const summary of review.changes.fileSummaries) {
      console.log(`- ${formatDiffFileSummary(summary)}\t${summary.reviewHint}`);
    }
  }
  if (review.commands.length > 0) {
    console.log("");
    console.log("Commands:");
    for (const command of review.commands) {
      const timedOut = command.timedOut ? " timedOut=true" : "";
      const profile = command.executionProfile ? ` profile=${command.executionProfile}` : "";
      console.log(`- ${command.ordinal}. ${command.status}\texit=${command.exitCode ?? "-"}${timedOut}${profile}\t${command.command ?? "-"}`);
    }
  }
  if (review.approvals.length > 0) {
    console.log("");
    console.log("Approvals:");
    for (const approval of review.approvals) {
      console.log(`- ${approval.status}\t${approval.action}\t${approval.toolName ?? "-"}\t${approval.reason}`);
    }
  }
  console.log("");
  console.log("Review:");
  console.log(`- ${review.reviewCommands.diff}`);
  console.log(`- ${review.reviewCommands.timeline}`);
  console.log(`- ${review.reviewCommands.result}`);
  console.log(`- ${review.reviewCommands.verify}`);
}

function timelineItemFromAudit(event: AuditEvent): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "audit",
    createdAt: event.createdAt,
    sourceId: event.id,
    actor: actorLabel(event.actor),
    title: event.type,
    summary: event.summary,
    action: typeof event.metadata?.action === "string" ? event.metadata.action : undefined,
    toolName: typeof event.metadata?.tool === "string" ? event.metadata.tool : undefined,
    command: typeof event.metadata?.command === "string" ? event.metadata.command : undefined,
    exitCode: commandExitCode(event.metadata),
    timedOut: commandTimedOut(event.metadata),
    durationMs: commandDurationMs(event.metadata),
    executionProfile: commandExecutionProfileName(event.metadata),
    metadata: safeTimelineMetadata(event.metadata),
  };
}

function timelineItemFromFileChange(change: FileChange): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "file_change",
    createdAt: change.createdAt,
    sourceId: change.id,
    actor: actorLabel(change.actor),
    title: `${change.kind} ${change.path}`,
    summary: change.summary,
    path: change.path,
    metadata: {
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
    },
  };
}

function timelineItemFromApproval(approval: ApprovalRequest): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "approval",
    createdAt: approval.createdAt,
    sourceId: approval.id,
    actor: actorLabel(approval.requestedBy),
    title: `approval requested ${approval.action}`,
    summary: approval.reason,
    status: approval.status,
    action: approval.action,
    toolName: approval.toolName,
    metadata: {
      approverHint: approval.approverHint,
    },
  };
}

function timelineItemFromApprovalDecision(approval: ApprovalRequest): Omit<SessionTimelineItem, "ordinal"> {
  return {
    kind: "approval_decision",
    createdAt: approval.decidedAt ?? approval.createdAt,
    sourceId: `${approval.id}:decision`,
    actor: approval.decisionBy ? actorLabel(approval.decisionBy) : undefined,
    title: `approval ${approval.status} ${approval.action}`,
    summary: approval.decisionReason ?? approval.reason,
    status: approval.status,
    action: approval.action,
    toolName: approval.toolName,
  };
}

function timelineKindOrder(kind: SessionTimelineItemKind): number {
  switch (kind) {
    case "audit":
      return 0;
    case "approval":
      return 1;
    case "approval_decision":
      return 2;
    case "file_change":
      return 3;
  }
}

function countTimelineKinds(items: Array<{ kind: SessionTimelineItemKind }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}

function safeTimelineMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  const safe: Record<string, unknown> = {};
  for (const key of ["action", "tool", "ok", "exitCode", "timedOut", "durationMs", "executionProfile", "stdoutBytes", "stderrBytes", "approvalId"]) {
    const value = metadata[key];
    if (value !== undefined) {
      safe[key] = value;
    }
  }
  const error = metadata.error;
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    safe.error = {
      code: typeof maybe.code === "string" ? maybe.code : undefined,
      message: typeof maybe.message === "string" ? singleLine(maybe.message) : undefined,
    };
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function actorLabel(actor: { type: string; id: string }): string {
  return `${actor.type}:${actor.id}`;
}

async function buildSessionResult(store: AgentStore, sessionId: string) {
  const report = await buildSessionReport(store, sessionId);
  const diff = await buildSessionDiff(store, sessionId);
  const finishedCommands = report.commandEvents.filter((event) => event.type === "command.finished");
  const failedCommands = finishedCommands.filter((event) => event.timedOut || (event.exitCode !== undefined && event.exitCode !== 0));
  const timedOutCommands = finishedCommands.filter((event) => event.timedOut);
  const firstFailedIndex = finishedCommands.findIndex((event) => event.timedOut || (event.exitCode !== undefined && event.exitCode !== 0));
  const recoveryCommand = firstFailedIndex >= 0
    ? finishedCommands.slice(firstFailedIndex + 1).find((event) => event.exitCode === 0 && !event.timedOut)
    : undefined;
  const lastCommand = finishedCommands.at(-1);
  const outcome = sessionResultOutcome(report.session.status, lastCommand?.exitCode, lastCommand?.timedOut);
  const changedPaths = [...new Set([...report.summary.changedPaths, ...diff.summary.changedPaths])].sort();

  return {
    generatedAt: new Date().toISOString(),
    session: report.session,
    summary: {
      outcome,
      recovered: Boolean(recoveryCommand),
      status: report.session.status,
      targetMode: report.session.targetMode,
      changedPaths,
      fileChanges: report.summary.fileChanges,
      patches: diff.summary.patches,
      commandsFinished: finishedCommands.length,
      failedCommands: failedCommands.length,
      timedOutCommands: timedOutCommands.length,
      executionProfiles: report.summary.executionProfiles,
      diffStats: diff.summary.diffStats,
      fileSummaries: diff.summary.fileSummaries,
      approvals: report.summary.approvals,
      pendingApprovals: report.summary.pendingApprovals,
      approvedApprovals: report.summary.approvedApprovals,
      deniedApprovals: report.summary.deniedApprovals,
      toolResults: report.summary.toolResults,
      failedToolResults: report.summary.failedToolResults,
      lastCommand: lastCommand
        ? {
            command: lastCommand.command,
            exitCode: lastCommand.exitCode,
            timedOut: lastCommand.timedOut,
            durationMs: lastCommand.durationMs,
            executionProfile: lastCommand.executionProfile,
            createdAt: lastCommand.createdAt,
          }
        : undefined,
    },
    recovery: {
      observedFailure: failedCommands.length > 0,
      recovered: Boolean(recoveryCommand),
      firstFailedCommand: firstFailedIndex >= 0
        ? {
            command: finishedCommands[firstFailedIndex].command,
            exitCode: finishedCommands[firstFailedIndex].exitCode,
            timedOut: finishedCommands[firstFailedIndex].timedOut,
            durationMs: finishedCommands[firstFailedIndex].durationMs,
            executionProfile: finishedCommands[firstFailedIndex].executionProfile,
            createdAt: finishedCommands[firstFailedIndex].createdAt,
          }
        : undefined,
      recoveryCommand: recoveryCommand
        ? {
            command: recoveryCommand.command,
            exitCode: recoveryCommand.exitCode,
            timedOut: recoveryCommand.timedOut,
            durationMs: recoveryCommand.durationMs,
            executionProfile: recoveryCommand.executionProfile,
            createdAt: recoveryCommand.createdAt,
          }
        : undefined,
    },
    commands: finishedCommands.map((event, index) => ({
      ordinal: index + 1,
      status: event.timedOut ? "timeout" : event.exitCode === 0 ? "pass" : event.exitCode === undefined || event.exitCode === null ? "unknown" : "fail",
      command: event.command,
      exitCode: event.exitCode,
      timedOut: event.timedOut,
      durationMs: event.durationMs,
      executionProfile: event.executionProfile,
      createdAt: event.createdAt,
      stdoutBytes: event.stdoutBytes,
      stderrBytes: event.stderrBytes,
    })),
    approvals: report.approvals,
    fileChanges: report.fileChanges,
    patches: diff.patches.map((patch) => ({
      ordinal: patch.ordinal,
      createdAt: patch.createdAt,
      paths: patch.paths,
      stats: patch.stats,
      fileSummaries: patch.fileSummaries,
      hasPatchText: Boolean(patch.patch),
    })),
    reviewCommands: {
      review: `agent session review ${sessionId}`,
      diff: `agent session diff ${sessionId}`,
      status: `agent session status ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
      rawSession: `agent show-session ${sessionId}`,
    },
  };
}

function sessionResultOutcome(sessionStatus: string, lastCommandExitCode: number | null | undefined, lastCommandTimedOut?: boolean): "succeeded" | "failed" | "paused" | "cancelled" | "in_progress" | "unknown" {
  if (sessionStatus === "completed") {
    return !lastCommandTimedOut && (lastCommandExitCode === undefined || lastCommandExitCode === null || lastCommandExitCode === 0) ? "succeeded" : "failed";
  }
  if (sessionStatus === "failed") {
    return "failed";
  }
  if (sessionStatus === "paused") {
    return "paused";
  }
  if (sessionStatus === "cancelled") {
    return "cancelled";
  }
  if (sessionStatus === "created" || sessionStatus === "running") {
    return "in_progress";
  }
  return "unknown";
}

function printSessionResult(result: Awaited<ReturnType<typeof buildSessionResult>>): void {
  console.log(`Session result: ${result.session.id}`);
  console.log(
    `outcome=${result.summary.outcome}\trecovered=${result.summary.recovered ? "yes" : "no"}\t` +
    `status=${result.summary.status}\ttarget=${result.summary.targetMode}`,
  );
  console.log(`objective: ${result.session.objective}`);
  console.log("");
  console.log("Summary:");
  console.log(`- changedPaths=${result.summary.changedPaths.length ? result.summary.changedPaths.join(",") : "-"}`);
  console.log(`- fileChanges=${result.summary.fileChanges}`);
  console.log(`- patches=${result.summary.patches}`);
  console.log(`- diffStats=${formatDiffStats(result.summary.diffStats)}`);
  console.log(`- fileSummaries=${formatDiffFileSummaryList(result.summary.fileSummaries)}`);
  console.log(`- commandsFinished=${result.summary.commandsFinished} failed=${result.summary.failedCommands} timedOut=${result.summary.timedOutCommands}`);
  console.log(`- executionProfiles=${formatRecordCounts(result.summary.executionProfiles)}`);
  console.log(`- approvals=${result.summary.approvals} pending=${result.summary.pendingApprovals}`);
  console.log(`- toolResults=${result.summary.toolResults} failed=${result.summary.failedToolResults}`);
  if (result.recovery.observedFailure) {
    const failed = result.recovery.firstFailedCommand;
    const recovered = result.recovery.recoveryCommand;
    console.log("");
    console.log("Recovery:");
    console.log(`- firstFailure exit=${failed?.exitCode ?? "-"}\t${failed?.command ?? "-"}`);
    console.log(`- recovery exit=${recovered?.exitCode ?? "-"}\t${recovered?.command ?? "-"}`);
  }
  if (result.commands.length > 0) {
    console.log("");
    console.log("Commands:");
    for (const command of result.commands) {
      const timedOut = command.timedOut ? " timedOut=true" : "";
      const profile = command.executionProfile ? ` profile=${command.executionProfile}` : "";
      console.log(`- ${command.ordinal}. ${command.status}\texit=${command.exitCode ?? "-"}${timedOut}${profile}\t${command.command ?? "-"}`);
    }
  }
  if (result.fileChanges.length > 0) {
    console.log("");
    console.log("Changed files:");
    for (const change of result.fileChanges) {
      console.log(`- ${change.kind}\t${change.path}\t${change.summary}`);
    }
  }
  if (result.approvals.length > 0) {
    console.log("");
    console.log("Approvals:");
    for (const approval of result.approvals) {
      console.log(`- ${approval.status}\t${approval.action}\t${approval.toolName ?? "-"}\t${approval.reason}`);
    }
  }
  console.log("");
  console.log("Review:");
  console.log(`- ${result.reviewCommands.review}`);
  console.log(`- ${result.reviewCommands.diff}`);
  console.log(`- ${result.reviewCommands.timeline}`);
  console.log(`- ${result.reviewCommands.report}`);
  console.log(`- ${result.reviewCommands.audit}`);
}

type SessionVerificationOptions = {
  requireChange?: boolean;
  requirePatch?: boolean;
  requireRecovery?: boolean;
  requireTimeout?: boolean;
  requireDiffStat?: boolean;
  requiredExecutionProfiles?: CommandExecutionProfileName[];
  requiredApprovalActions?: PolicyAction[];
  requireCommand?: boolean;
};

type SessionVerificationCheck = {
  id: string;
  label: string;
  status: "pass" | "fail";
  summary: string;
};

async function buildSessionVerification(store: AgentStore, sessionId: string, options: SessionVerificationOptions = {}) {
  const result = await buildSessionResult(store, sessionId);
  const checks: SessionVerificationCheck[] = [];
  const requireCommand = options.requireCommand !== false;

  checks.push({
    id: "session-succeeded",
    label: "session succeeded",
    status: result.summary.outcome === "succeeded" ? "pass" : "fail",
    summary: `outcome=${result.summary.outcome}, status=${result.summary.status}`,
  });
  checks.push({
    id: "tools-clean",
    label: "tools clean",
    status: result.summary.failedToolResults === 0 ? "pass" : "fail",
    summary: `${result.summary.failedToolResults} failed tool result(s) out of ${result.summary.toolResults}`,
  });
  if (requireCommand) {
    const lastCommand = result.summary.lastCommand;
    checks.push({
      id: "command-verified",
      label: "command verified",
      status: result.summary.commandsFinished > 0 && lastCommand?.exitCode === 0 && !lastCommand.timedOut ? "pass" : "fail",
      summary: `commandsFinished=${result.summary.commandsFinished}, lastExit=${lastCommand?.exitCode ?? "-"}, timedOut=${lastCommand?.timedOut ?? false}`,
    });
  }
  if (options.requireChange) {
    checks.push({
      id: "change-evidence",
      label: "change evidence",
      status: result.summary.fileChanges > 0 && result.summary.changedPaths.length > 0 ? "pass" : "fail",
      summary: `${result.summary.fileChanges} file change(s), ${result.summary.changedPaths.length} changed path(s)`,
    });
  }
  if (options.requirePatch) {
    checks.push({
      id: "patch-evidence",
      label: "patch evidence",
      status: result.summary.patches > 0 ? "pass" : "fail",
      summary: `${result.summary.patches} persisted patch(es)`,
    });
  }
  if (options.requireDiffStat) {
    checks.push({
      id: "diff-stat-evidence",
      label: "diff stat evidence",
      status: result.summary.diffStats.files > 0 && (result.summary.diffStats.additions > 0 || result.summary.diffStats.deletions > 0) ? "pass" : "fail",
      summary: formatDiffStats(result.summary.diffStats),
    });
  }
  if (options.requireRecovery) {
    checks.push({
      id: "recovery-evidence",
      label: "recovery evidence",
      status: result.recovery.observedFailure && result.recovery.recovered ? "pass" : "fail",
      summary: `observedFailure=${result.recovery.observedFailure}, recovered=${result.recovery.recovered}`,
    });
  }
  if (options.requireTimeout) {
    checks.push({
      id: "timeout-evidence",
      label: "timeout evidence",
      status: result.summary.timedOutCommands > 0 ? "pass" : "fail",
      summary: `${result.summary.timedOutCommands} timed-out command(s)`,
    });
  }
  for (const profile of [...new Set(options.requiredExecutionProfiles ?? [])]) {
    const count = result.summary.executionProfiles[profile] ?? 0;
    checks.push({
      id: `execution-profile-${profile.replace(/[^a-z0-9]+/gi, "-")}`,
      label: `execution profile ${profile}`,
      status: count > 0 ? "pass" : "fail",
      summary: `${count} finished command(s) recorded with ${profile}`,
    });
  }
  for (const action of [...new Set(options.requiredApprovalActions ?? [])]) {
    const approvals = result.approvals.filter((approval) => approval.action === action);
    checks.push({
      id: `approval-${action.replace(/[^a-z0-9]+/gi, "-")}`,
      label: `approval ${action}`,
      status: approvals.length > 0 ? "pass" : "fail",
      summary: `${approvals.length} approval request(s) for ${action}`,
    });
  }

  const status: "pass" | "fail" = checks.some((check) => check.status === "fail") ? "fail" : "pass";
  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    status,
    options: {
      requireCommand,
      requireChange: Boolean(options.requireChange),
      requirePatch: Boolean(options.requirePatch),
      requireRecovery: Boolean(options.requireRecovery),
      requireTimeout: Boolean(options.requireTimeout),
      requireDiffStat: Boolean(options.requireDiffStat),
      requiredExecutionProfiles: [...new Set(options.requiredExecutionProfiles ?? [])],
      requiredApprovalActions: [...new Set(options.requiredApprovalActions ?? [])],
    },
    summary: result.summary,
    checks,
    reviewCommands: result.reviewCommands,
  };
}

function printSessionVerification(verification: Awaited<ReturnType<typeof buildSessionVerification>>): void {
  console.log(`Session verification: ${verification.session.id}`);
  console.log(`status=${verification.status}\toutcome=${verification.summary.outcome}\trecovered=${verification.summary.recovered ? "yes" : "no"}`);
  console.log("");
  for (const check of verification.checks) {
    console.log(`[${check.status}] ${check.label}: ${check.summary}`);
  }
  console.log("");
  console.log("Review:");
  console.log(`- ${verification.reviewCommands.review}`);
  console.log(`- ${verification.reviewCommands.diff}`);
  console.log(`- ${verification.reviewCommands.timeline}`);
  console.log(`- ${verification.reviewCommands.report}`);
  console.log(`- ${verification.reviewCommands.audit}`);
}

function commandExitCode(metadata: Record<string, unknown> | undefined): number | null | undefined {
  const value = metadata?.exitCode;
  if (typeof value === "number" || value === null) {
    return value;
  }
  return undefined;
}

function commandTimedOut(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.timedOut === true;
}

function commandDurationMs(metadata: Record<string, unknown> | undefined): number | undefined {
  return typeof metadata?.durationMs === "number" ? metadata.durationMs : undefined;
}

function commandExecutionProfileName(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.executionProfile === "string" ? metadata.executionProfile : undefined;
}

function commandExecutionProfileCounts(events: Array<{ metadata?: Record<string, unknown> }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const profile = commandExecutionProfileName(event.metadata);
    if (!profile) {
      continue;
    }
    counts[profile] = (counts[profile] ?? 0) + 1;
  }
  return counts;
}

function formatRecordCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? "-" : entries.map(([key, value]) => `${key}:${value}`).join(",");
}

function singleLine(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 160)} [truncated]` : compact;
}

async function buildSessionDiff(store: AgentStore, sessionId: string) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 500 });
  const fileChanges = await store.listFileChanges(sessionId);
  const patchEvents = sessionPatchAuditEvents(auditEvents);
  const patches = patchEvents.map((event, index) => {
    const patch = auditPatchInput(event.metadata);
    const paths = patch ? extractUnifiedDiffPaths(patch) : [];
    const stats = summarizeUnifiedDiffPatch(patch);
    const fileSummaries = summarizeDiffFileSummaries([{ ordinal: index + 1, patch, stats }]);
    return {
      ordinal: index + 1,
      createdAt: event.createdAt,
      actor: event.actor,
      summary: event.summary,
      paths,
      stats,
      fileSummaries,
      patch,
    };
  });
  const diffStats = mergeDiffStats(patches.map((patch) => patch.stats));
  const fileSummaries = summarizeDiffFileSummaries(patches);
  return {
    generatedAt: new Date().toISOString(),
    session,
    summary: {
      patches: patches.length,
      fileChanges: fileChanges.length,
      changedPaths: [...new Set(fileChanges.map((change) => change.path))].sort(),
      diffStats,
      fileSummaries,
    },
    patches,
    fileChanges,
  };
}

function printSessionDiff(diff: Awaited<ReturnType<typeof buildSessionDiff>>): void {
  console.log(`Session diff: ${diff.session.id}`);
  console.log(`status=${diff.session.status}\tpatches=${diff.summary.patches}\tfileChanges=${diff.summary.fileChanges}`);
  console.log(`diffStats=${formatDiffStats(diff.summary.diffStats)}`);
  if (diff.summary.changedPaths.length > 0) {
    console.log(`changedPaths=${diff.summary.changedPaths.join(",")}`);
  }
  if (diff.summary.fileSummaries.length > 0) {
    console.log("File summary:");
    for (const summary of diff.summary.fileSummaries) {
      console.log(`- ${formatDiffFileSummary(summary)}\t${summary.reviewHint}`);
    }
  }
  if (diff.patches.length === 0) {
    console.log("No apply_patch audit events found for this session.");
    return;
  }
  for (const patch of diff.patches) {
    console.log("");
    console.log(`# patch ${patch.ordinal}\t${patch.createdAt}\tpaths=${patch.paths.join(",") || "-"}\t${formatDiffStats(patch.stats)}`);
    if (patch.patch) {
      process.stdout.write(patch.patch.endsWith("\n") ? patch.patch : `${patch.patch}\n`);
    } else {
      console.log("[patch input unavailable]");
    }
  }
}

function sessionPatchAuditEvents(auditEvents: AuditEvent[]): AuditEvent[] {
  return auditEvents
    .filter((event) =>
      event.type === "tool.completed" &&
      event.metadata?.tool === "apply_patch" &&
      event.metadata?.ok === true
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function auditPatchInput(metadata: Record<string, unknown> | undefined): string | undefined {
  const input = metadata?.input;
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const patch = (input as Record<string, unknown>).patch;
  return typeof patch === "string" ? patch : undefined;
}

type UnifiedDiffPathStats = {
  path: string;
  additions: number;
  deletions: number;
};

type UnifiedDiffChangeType = "added" | "deleted" | "modified" | "renamed";

type UnifiedDiffReviewSize = "small" | "medium" | "large";

type UnifiedDiffFileSummary = UnifiedDiffPathStats & {
  changeType: UnifiedDiffChangeType;
  patches: number;
  firstPatchOrdinal: number;
  lastPatchOrdinal: number;
  reviewSize: UnifiedDiffReviewSize;
  reviewHint: string;
};

type UnifiedDiffStats = {
  files: number;
  additions: number;
  deletions: number;
  byPath: UnifiedDiffPathStats[];
};

function summarizeUnifiedDiffPatch(patch: string | undefined): UnifiedDiffStats {
  if (!patch) {
    return emptyDiffStats();
  }
  const byPath = new Map<string, UnifiedDiffPathStats>();
  let oldPath: string | undefined;
  let currentPath: string | undefined;
  let inHunk = false;

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = undefined;
      currentPath = undefined;
      inHunk = false;
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = parseUnifiedDiffPath(line, "--- ");
      currentPath = oldPath;
      inHunk = false;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseUnifiedDiffPath(line, "+++ ");
      currentPath = newPath ?? oldPath;
      if (currentPath) {
        ensureDiffPathStats(byPath, currentPath);
      }
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      if (currentPath) {
        ensureDiffPathStats(byPath, currentPath);
      }
      continue;
    }
    if (!inHunk || !currentPath) {
      continue;
    }
    if (line.startsWith("+")) {
      ensureDiffPathStats(byPath, currentPath).additions += 1;
    } else if (line.startsWith("-")) {
      ensureDiffPathStats(byPath, currentPath).deletions += 1;
    }
  }

  return diffStatsFromMap(byPath);
}

function mergeDiffStats(stats: UnifiedDiffStats[]): UnifiedDiffStats {
  const byPath = new Map<string, UnifiedDiffPathStats>();
  for (const stat of stats) {
    for (const entry of stat.byPath) {
      const target = ensureDiffPathStats(byPath, entry.path);
      target.additions += entry.additions;
      target.deletions += entry.deletions;
    }
  }
  return diffStatsFromMap(byPath);
}

function ensureDiffPathStats(byPath: Map<string, UnifiedDiffPathStats>, pathName: string): UnifiedDiffPathStats {
  const existing = byPath.get(pathName);
  if (existing) {
    return existing;
  }
  const created = { path: pathName, additions: 0, deletions: 0 };
  byPath.set(pathName, created);
  return created;
}

function diffStatsFromMap(byPath: Map<string, UnifiedDiffPathStats>): UnifiedDiffStats {
  const entries = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: entries.length,
    additions: entries.reduce((total, entry) => total + entry.additions, 0),
    deletions: entries.reduce((total, entry) => total + entry.deletions, 0),
    byPath: entries,
  };
}

function emptyDiffStats(): UnifiedDiffStats {
  return { files: 0, additions: 0, deletions: 0, byPath: [] };
}

function formatDiffStats(stats: UnifiedDiffStats): string {
  return `files:${stats.files},+${stats.additions},-${stats.deletions}`;
}

function summarizeDiffFileSummaries(patches: Array<{ ordinal: number; patch?: string; stats: UnifiedDiffStats }>): UnifiedDiffFileSummary[] {
  const byPath = new Map<string, {
    path: string;
    additions: number;
    deletions: number;
    patches: number;
    firstPatchOrdinal: number;
    lastPatchOrdinal: number;
    changeTypes: Set<UnifiedDiffChangeType>;
  }>();

  for (const patch of patches) {
    const changeTypes = patch.patch ? extractUnifiedDiffPathChangeTypes(patch.patch) : new Map<string, UnifiedDiffChangeType>();
    for (const entry of patch.stats.byPath) {
      const existing = byPath.get(entry.path);
      const target = existing ?? {
        path: entry.path,
        additions: 0,
        deletions: 0,
        patches: 0,
        firstPatchOrdinal: patch.ordinal,
        lastPatchOrdinal: patch.ordinal,
        changeTypes: new Set<UnifiedDiffChangeType>(),
      };
      target.additions += entry.additions;
      target.deletions += entry.deletions;
      target.patches += 1;
      target.firstPatchOrdinal = Math.min(target.firstPatchOrdinal, patch.ordinal);
      target.lastPatchOrdinal = Math.max(target.lastPatchOrdinal, patch.ordinal);
      target.changeTypes.add(changeTypes.get(entry.path) ?? "modified");
      byPath.set(entry.path, target);
    }
  }

  return [...byPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => {
      const changeType = summarizeChangeTypes(entry.changeTypes);
      const reviewSize = diffReviewSize(entry.additions, entry.deletions);
      return {
        path: entry.path,
        changeType,
        additions: entry.additions,
        deletions: entry.deletions,
        patches: entry.patches,
        firstPatchOrdinal: entry.firstPatchOrdinal,
        lastPatchOrdinal: entry.lastPatchOrdinal,
        reviewSize,
        reviewHint: `${changeType} ${reviewSize} change (+${entry.additions}/-${entry.deletions})`,
      };
    });
}

function summarizeChangeTypes(changeTypes: Set<UnifiedDiffChangeType>): UnifiedDiffChangeType {
  if (changeTypes.size === 1) {
    return [...changeTypes][0] ?? "modified";
  }
  if (changeTypes.has("renamed")) {
    return "renamed";
  }
  return "modified";
}

function diffReviewSize(additions: number, deletions: number): UnifiedDiffReviewSize {
  const changedLines = additions + deletions;
  if (changedLines >= 200) {
    return "large";
  }
  if (changedLines >= 50) {
    return "medium";
  }
  return "small";
}

function formatDiffFileSummary(summary: UnifiedDiffFileSummary): string {
  return `${summary.path}\t${summary.changeType}\t+${summary.additions}/-${summary.deletions}\tpatches=${summary.patches}\t${summary.reviewSize}`;
}

function formatDiffFileSummaryList(summaries: UnifiedDiffFileSummary[]): string {
  return summaries.length === 0
    ? "-"
    : summaries.map((summary) => `${summary.path}:${summary.changeType}:+${summary.additions}/-${summary.deletions}`).join(",");
}

function extractUnifiedDiffPathChangeTypes(patch: string): Map<string, UnifiedDiffChangeType> {
  const types = new Map<string, UnifiedDiffChangeType>();
  let oldPath: string | undefined;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = undefined;
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = parseUnifiedDiffPath(line, "--- ");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseUnifiedDiffPath(line, "+++ ");
      const target = newPath ?? oldPath;
      if (target) {
        types.set(target, classifyUnifiedDiffChange(oldPath, newPath));
      }
      oldPath = undefined;
    }
  }
  return types;
}

function classifyUnifiedDiffChange(oldPath: string | undefined, newPath: string | undefined): UnifiedDiffChangeType {
  if (!oldPath && newPath) {
    return "added";
  }
  if (oldPath && !newPath) {
    return "deleted";
  }
  if (oldPath && newPath && oldPath !== newPath) {
    return "renamed";
  }
  return "modified";
}

function extractUnifiedDiffPaths(patch: string): string[] {
  const paths: string[] = [];
  let oldPath: string | undefined;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("--- ")) {
      oldPath = parseUnifiedDiffPath(line, "--- ");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseUnifiedDiffPath(line, "+++ ");
      const target = newPath ?? oldPath;
      if (target) {
        paths.push(target);
      }
      oldPath = undefined;
    }
  }
  return [...new Set(paths)].sort();
}

function parseUnifiedDiffPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  const raw = line.slice(prefix.length).trim();
  if (raw === "/dev/null") {
    return undefined;
  }
  const withoutTimestamp = raw.split("\t")[0].trim();
  const unquoted = withoutTimestamp.startsWith("\"") && withoutTimestamp.endsWith("\"")
    ? withoutTimestamp.slice(1, -1)
    : withoutTimestamp;
  return unquoted.replace(/^(a|b)\//, "");
}

type SoloclawStatus = {
  generatedAt: string;
  workspace: string;
  activeWorkspace?: string;
  workspaceConfigPath: string;
  model: {
    activeProvider: ModelProviderName;
    defaultProvider?: ModelProviderName;
    configPath: string;
    profiles: Awaited<ReturnType<LocalProviderProfileStore["list"]>>;
  };
  readiness: PhaseOneReadinessResult;
};

type SoloclawQuickstartView = {
  generatedAt: string;
  workspace: string;
  workspaceConfigPath: string;
  modelConfigPath: string;
  defaultProvider?: ModelProviderName;
  commands: {
    tui: string;
    init: string;
    providers: string;
    setupWizard: string;
    modelSetupLocal: string;
    modelEnvLocal: string;
    modelCheck: string;
    smoke: string;
    ask: string;
    status: string;
  };
};

async function runSoloclawSmoke(workspace: string): Promise<string> {
  const platform = await createLocalPlatform(workspace, {
    provider: "mock",
    workspaceSnapshot: true,
  });
  try {
    return await platform.agent.run("inspect this workspace");
  } finally {
    platform.locks.close?.();
    platform.store.close();
  }
}

type ModelEnvView = {
  generatedAt: string;
  provider: ModelProviderName;
  model: string;
  protocol: "openai_chat" | "anthropic_messages" | "mock";
  source: "builtin" | "local";
  configPath: string;
  apiKeyEnvNames: string[];
  commands: {
    powershell: string[];
    bash: string[];
    cmd: string[];
  };
};

async function buildSoloclawStatus(historyRoot: string, workspace: string, activeProvider?: ModelProviderName): Promise<SoloclawStatus> {
  const history = await readWorkspaceHistory(historyRoot);
  const profileStore = new LocalProviderProfileStore(path.join(workspace, ".agent"));
  const defaultProvider = await profileStore.getDefaultProvider();
  const profiles = await profileStore.list();
  const readiness = await verifyPhaseOneReadiness(workspace);
  return {
    generatedAt: new Date().toISOString(),
    workspace,
    activeWorkspace: history.activeWorkspace,
    workspaceConfigPath: workspaceHistoryPath(historyRoot),
    model: {
      activeProvider: activeProvider ?? defaultProvider ?? "mock",
      defaultProvider,
      configPath: profileStore.filePath,
      profiles,
    },
    readiness,
  };
}

async function buildSoloclawQuickstart(historyRoot: string, workspace: string): Promise<SoloclawQuickstartView> {
  const profileStore = new LocalProviderProfileStore(path.join(workspace, ".agent"));
  const defaultProvider = await profileStore.getDefaultProvider();
  return {
    generatedAt: new Date().toISOString(),
    workspace,
    workspaceConfigPath: workspaceHistoryPath(historyRoot),
    modelConfigPath: profileStore.filePath,
    defaultProvider,
    commands: {
      tui: "soloclaw",
      init: "soloclaw init",
      providers: "soloclaw providers",
      setupWizard: "soloclaw setup --wizard",
      modelSetupLocal: "soloclaw setup --local --model <model>",
      modelEnvLocal: "soloclaw model env local",
      modelCheck: "soloclaw model check",
      smoke: "soloclaw smoke",
      ask: 'soloclaw ask "inspect this workspace"',
      status: "soloclaw status",
    },
  };
}

async function buildModelEnvView(workspaceRoot: string, args: string[], activeProvider?: ModelProviderName): Promise<{ json: boolean; view: ModelEnvView }> {
  const parsed = parseModelProfileArgs(args);
  const profiles = new LocalProviderProfileStore(path.join(workspaceRoot, ".agent"));
  const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
  const provider = parsed.options.provider ?? (providerInput ? parseModelProviderName(providerInput) : activeProvider ?? await profiles.getDefaultProvider() ?? "mock");
  const profile = (await profiles.list()).find((entry) => entry.name === provider);
  if (!profile) {
    throw new Error(`Unknown model provider: ${provider}`);
  }
  const apiKeyEnvNames = resolveModelApiKeyEnvNames(parsed.options, providerInput, profile.apiKeyEnvNames);
  return {
    json: Boolean(parsed.options.json),
    view: {
      generatedAt: new Date().toISOString(),
      provider,
      model: parsed.options.model ?? profile.defaultModel,
      protocol: profile.protocol,
      source: profile.source,
      configPath: profiles.filePath,
      apiKeyEnvNames,
      commands: {
        powershell: apiKeyEnvNames.map((envName) => `$env:${envName}="<api-key>"`),
        bash: apiKeyEnvNames.map((envName) => `export ${envName}="<api-key>"`),
        cmd: apiKeyEnvNames.map((envName) => `set ${envName}=<api-key>`),
      },
    },
  };
}

function printSoloclawStatus(status: SoloclawStatus): void {
  console.log("Soloclaw status");
  console.log(`workspace=${status.workspace}`);
  console.log(`activeWorkspace=${status.activeWorkspace ?? "-"}`);
  console.log(`workspaceConfig=${status.workspaceConfigPath}`);
  console.log(`model=${status.model.activeProvider}`);
  console.log(`modelDefault=${status.model.defaultProvider ?? "-"}`);
  console.log(`modelConfig=${status.model.configPath}`);
  console.log(`readiness=${status.readiness.status}`);
  for (const check of status.readiness.checks) {
    console.log(`[${check.status}] ${check.label}: ${check.summary}`);
  }
}

function printSoloclawQuickstart(view: SoloclawQuickstartView): void {
  console.log("Soloclaw quickstart");
  console.log(`workspace=${view.workspace}`);
  console.log(`workspaceConfig=${view.workspaceConfigPath}`);
  console.log(`modelConfig=${view.modelConfigPath}`);
  console.log(`defaultModel=${view.defaultProvider ?? "-"}`);
  console.log("First run:");
  console.log(`1. ${view.commands.init}`);
  console.log(`2. ${view.commands.providers}`);
  console.log(`3. ${view.commands.setupWizard}`);
  console.log(`4. ${view.commands.modelSetupLocal}`);
  console.log(`5. ${view.commands.modelEnvLocal}`);
  console.log(`6. ${view.commands.modelCheck}`);
  console.log(`7. ${view.commands.smoke}`);
  console.log(`8. ${view.commands.ask}`);
  console.log(`next=${view.commands.tui}`);
}

function printModelProviderProfiles(profiles: ModelProviderProfileView[], defaultProvider: ModelProviderName | undefined): void {
  for (const profile of profiles) {
    console.log(
      `${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}${profile.name === defaultProvider ? "\tdefault" : ""}`,
    );
  }
}

function printModelProviderProfilesJson(profiles: ModelProviderProfileView[], defaultProvider: ModelProviderName | undefined, configPath: string): void {
  console.log(JSON.stringify({ providers: profiles, defaultProvider, configPath }, null, 2));
}

function printSoloclawInitView(view: SoloclawInitView): void {
  console.log("Soloclaw initialized");
  console.log(`workspace=${view.workspace}`);
  console.log(`workspaceConfig=${view.workspaceConfigPath}`);
  console.log(`modelConfig=${view.modelConfigPath}`);
  console.log(`defaultModel=${view.defaultProvider ?? "-"}`);
  console.log("next=soloclaw");
}

function printModelEnvView(view: ModelEnvView): void {
  console.log("Model env");
  console.log(`provider=${view.provider}`);
  console.log(`model=${view.model}`);
  console.log(`protocol=${view.protocol}`);
  console.log(`source=${view.source}`);
  console.log(`config=${view.configPath}`);
  console.log(`apiKeyEnv=${view.apiKeyEnvNames.join(",") || "-"}`);
  if (view.apiKeyEnvNames.length === 0) {
    console.log("status=no_api_key_required");
  }
  for (const command of view.commands.powershell) {
    console.log(`powershell: ${command}`);
  }
  for (const command of view.commands.bash) {
    console.log(`bash: ${command}`);
  }
  for (const command of view.commands.cmd) {
    console.log(`cmd: ${command}`);
  }
  console.log("next=soloclaw model check");
}

function printModelCheckView(view: ModelCheckView): void {
  console.log("Model check");
  console.log(`provider=${view.provider}`);
  console.log(`status=${view.status}`);
  console.log(`model=${view.model}`);
  console.log(`protocol=${view.protocol}`);
  console.log(`source=${view.source}`);
  console.log(`baseUrl=${view.baseUrl ?? "-"}`);
  console.log(`config=${view.configPath}`);
  console.log(`apiKeyEnv=${view.apiKeyEnvNames.join(",") || "-"}`);
  console.log(`presentApiKeyEnv=${view.presentApiKeyEnvNames.join(",") || "-"}`);
  console.log(`missingApiKeyEnv=${view.missingApiKeyEnvNames.join(",") || "-"}`);
  if (view.status === "missing_api_key") {
    const envName = view.missingApiKeyEnvNames[0];
    console.log(`next=powershell: $env:${envName}="<api-key>"`);
    console.log(`next=bash: export ${envName}="<api-key>"`);
  }
  if (view.status === "missing_base_url") {
    console.log(`next=soloclaw model setup ${view.provider} --base-url <url> --model ${view.model}`);
  }
  if (view.ready) {
    console.log('next=soloclaw ask "inspect this workspace"');
  }
}

async function selectDefaultModelProvider(
  profiles: LocalProviderProfileStore,
  providerInput: string,
): Promise<{ defaultProvider: ModelProviderName; profile: ModelProviderProfileView }> {
  const providerName = parseModelProviderName(providerInput);
  const current = (await profiles.list()).find((profile) => profile.name === providerName);
  if (!current) {
    throw new Error(`Unknown model provider: ${providerName}`);
  }
  const localBaseUrl = localModelAliasBaseUrl(providerInput);
  const profile = localBaseUrl
    ? await profiles.set({
        name: providerName,
        protocol: current.protocol,
        defaultBaseUrl: localBaseUrl,
        defaultModel: current.defaultModel,
        apiKeyEnvNames: [],
      })
    : current;
  await profiles.setDefaultProvider(providerName);
  return { defaultProvider: providerName, profile };
}

type WorkspaceHistoryEntry = {
  path: string;
  lastUsedAt: string;
};

type WorkspaceHistoryFile = {
  version: 1;
  activeWorkspace?: string;
  entries: WorkspaceHistoryEntry[];
};

type SoloclawInitView = {
  generatedAt: string;
  workspace: string;
  workspaceConfigPath: string;
  modelConfigPath: string;
  defaultProvider?: ModelProviderName;
  configuredProvider?: ModelProviderName;
};

type ModelCheckStatus = "ready" | "missing_api_key" | "missing_base_url";

type ModelCheckView = {
  generatedAt: string;
  ready: boolean;
  status: ModelCheckStatus;
  provider: ModelProviderName;
  protocol: "openai_chat" | "anthropic_messages" | "mock";
  source: "builtin" | "local";
  model: string;
  baseUrl?: string;
  configPath: string;
  apiKeyEnvNames: string[];
  presentApiKeyEnvNames: string[];
  missingApiKeyEnvNames: string[];
};

function workspaceHistoryPath(historyRoot: string): string {
  return path.join(historyRoot, ".agent", "workspaces.json");
}

function parseWorkspaceOption(args: string[], fallback: string): string {
  const workspaceFlagIndex = args.indexOf("--workspace");
  if (workspaceFlagIndex >= 0 && args[workspaceFlagIndex + 1]) {
    return path.resolve(fallback, args[workspaceFlagIndex + 1]);
  }
  const workspaceEquals = args.find((arg) => arg.startsWith("--workspace="));
  if (workspaceEquals) {
    return path.resolve(fallback, workspaceEquals.slice("--workspace=".length));
  }
  return fallback;
}

function stripWorkspaceOption(args: string[]): string[] {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function hasWorkspaceOption(args: string[]): boolean {
  return args.some((arg) => arg === "--workspace" || arg.startsWith("--workspace="));
}

async function resolveInitialWorkspace(historyRoot: string, args: string[]): Promise<string> {
  const explicitWorkspace = parseWorkspaceOption(args, historyRoot);
  if (hasWorkspaceOption(args)) {
    return explicitWorkspace;
  }
  const history = await readWorkspaceHistory(historyRoot);
  return history.activeWorkspace ?? historyRoot;
}

async function readWorkspaceHistory(historyRoot: string): Promise<WorkspaceHistoryFile> {
  const filePath = workspaceHistoryPath(historyRoot);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<WorkspaceHistoryFile>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .filter((entry): entry is WorkspaceHistoryEntry => typeof entry?.path === "string" && typeof entry?.lastUsedAt === "string")
          .map((entry) => ({ path: path.resolve(entry.path), lastUsedAt: entry.lastUsedAt }))
      : [];
    return { version: 1, activeWorkspace: typeof parsed.activeWorkspace === "string" ? path.resolve(parsed.activeWorkspace) : undefined, entries };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw error;
  }
}

async function saveWorkspaceHistory(historyRoot: string, history: WorkspaceHistoryFile): Promise<void> {
  const filePath = workspaceHistoryPath(historyRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

async function recordWorkspaceHistoryEntry(historyRoot: string, workspace: string): Promise<string> {
  const resolvedWorkspace = path.resolve(workspace);
  await assertWorkspaceDirectory(resolvedWorkspace);
  const history = await readWorkspaceHistory(historyRoot);
  const key = workspaceHistoryKey(resolvedWorkspace);
  const entries = history.entries.filter((entry) => workspaceHistoryKey(entry.path) !== key);
  entries.unshift({ path: resolvedWorkspace, lastUsedAt: new Date().toISOString() });
  await saveWorkspaceHistory(historyRoot, { version: 1, activeWorkspace: resolvedWorkspace, entries: entries.slice(0, 20) });
  return resolvedWorkspace;
}

async function initializeSoloclawWorkspace(historyRoot: string, workspaceRoot: string, args: string[]): Promise<{ json: boolean; view: SoloclawInitView }> {
  let parsed = parseModelProfileArgs(args);
  if (parsed.options.wizard) {
    parsed = parseModelProfileArgs(await promptSoloclawSetupWizardArgs({ json: parsed.options.json }));
  }
  const workspace = await recordWorkspaceHistoryEntry(historyRoot, workspaceRoot);
  const profiles = new LocalProviderProfileStore(path.join(workspace, ".agent"));
  let configuredProvider: ModelProviderName | undefined;
  const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
  const providerName = parsed.options.provider ?? (providerInput ? parseModelProviderName(providerInput) : undefined);
  if (providerName) {
    const current = (await profiles.list()).find((profile) => profile.name === providerName);
    if (!current) {
      throw new Error(`Unknown model provider: ${providerName}`);
    }
    await profiles.set({
      name: providerName,
      protocol: parsed.options.protocol ?? current.protocol,
      defaultBaseUrl: parsed.options.baseUrl ?? localModelAliasBaseUrl(providerInput) ?? current.defaultBaseUrl,
      defaultModel: parsed.options.model ?? current.defaultModel,
      apiKeyEnvNames: resolveModelApiKeyEnvNames(parsed.options, providerInput, current.apiKeyEnvNames),
    });
    await profiles.setDefaultProvider(providerName);
    configuredProvider = providerName;
  } else {
    await profiles.setDefaultProvider("mock");
  }
  const defaultProvider = await profiles.getDefaultProvider();
  return {
    json: Boolean(parsed.options.json),
    view: {
      generatedAt: new Date().toISOString(),
      workspace,
      workspaceConfigPath: workspaceHistoryPath(historyRoot),
      modelConfigPath: profiles.filePath,
      defaultProvider,
      configuredProvider,
    },
  };
}

async function buildModelCheckView(workspaceRoot: string, args: string[], activeProvider?: ModelProviderName): Promise<{ json: boolean; view: ModelCheckView }> {
  const parsed = parseModelProfileArgs(args);
  const profiles = new LocalProviderProfileStore(path.join(workspaceRoot, ".agent"));
  const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
  const provider = parsed.options.provider ?? (providerInput ? parseModelProviderName(providerInput) : activeProvider ?? await profiles.getDefaultProvider() ?? "mock");
  const profile = (await profiles.list()).find((entry) => entry.name === provider);
  if (!profile) {
    throw new Error(`Unknown model provider: ${provider}`);
  }
  const apiKeyEnvNames = resolveModelApiKeyEnvNames(parsed.options, providerInput, profile.apiKeyEnvNames);
  const baseUrl = parsed.options.baseUrl ?? localModelAliasBaseUrl(providerInput) ?? profile.defaultBaseUrl;
  const presentApiKeyEnvNames = apiKeyEnvNames.filter((envName) => Boolean(process.env[envName]));
  const missingApiKeyEnvNames = profile.protocol === "mock" || apiKeyEnvNames.length === 0 || presentApiKeyEnvNames.length > 0 ? [] : apiKeyEnvNames;
  const status: ModelCheckStatus =
    profile.protocol !== "mock" && !baseUrl
      ? "missing_base_url"
      : missingApiKeyEnvNames.length > 0
        ? "missing_api_key"
        : "ready";
  return {
    json: Boolean(parsed.options.json),
    view: {
      generatedAt: new Date().toISOString(),
      ready: status === "ready",
      status,
      provider,
      protocol: profile.protocol,
      source: profile.source,
      model: parsed.options.model ?? profile.defaultModel,
      baseUrl,
      configPath: profiles.filePath,
      apiKeyEnvNames,
      presentApiKeyEnvNames,
      missingApiKeyEnvNames,
    },
  };
}

async function resolveWorkspaceSelector(historyRoot: string, selector: string, relativeRoot: string): Promise<string> {
  const index = Number(selector);
  if (Number.isInteger(index) && index > 0) {
    const history = await readWorkspaceHistory(historyRoot);
    const entry = history.entries[index - 1];
    if (!entry) {
      throw new Error(`Workspace selection out of range: ${selector}.`);
    }
    return entry.path;
  }
  return path.resolve(relativeRoot, selector);
}

async function assertWorkspaceDirectory(workspace: string): Promise<void> {
  const stat = await fs.stat(workspace);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspace}`);
  }
}

function workspaceHistoryKey(workspace: string): string {
  const resolved = path.resolve(workspace);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function printWorkspaceHistory(history: WorkspaceHistoryFile): void {
  if (history.activeWorkspace) {
    console.log(`active=${history.activeWorkspace}`);
  }
  if (history.entries.length === 0) {
    console.log("No recent workspaces.");
    return;
  }
  console.log("Recent workspaces:");
  history.entries.forEach((entry, index) => {
    console.log(`${index + 1}\t${entry.path}\t${entry.lastUsedAt}`);
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function splitCliWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const char of input) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    words.push(current);
  }
  return words;
}

async function startTui(initialWorkspace: string, historyRoot = initialWorkspace): Promise<void> {
  let workspace = initialWorkspace;
  await recordWorkspaceHistoryEntry(historyRoot, workspace);
  let profileStore = new LocalProviderProfileStore(path.join(workspace, ".agent"));
  let provider = (await profileStore.getDefaultProvider()) ?? "mock";
  const status = await buildSoloclawStatus(historyRoot, workspace, provider);
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("Soloclaw");
  console.log(`Workspace: ${workspace}`);
  console.log(`Model: ${provider}`);
  console.log(`Model config: ${profileStore.filePath}`);
  console.log(`Readiness: ${status.readiness.status}`);
  console.log("Next: /quickstart, /model check, /smoke");
  console.log("Commands: /run <task>, /smoke, /quickstart, /setup, /init, /status, /doctor, /inspect, /config, /model [provider], /workspace recent|<n>|<path>, /help, /exit");
  try {
    stdout.write("soloclaw> ");
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) {
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/exit" || line === "exit" || line === "quit") {
        console.log("bye");
        return;
      }
      if (line === "/help") {
        console.log("Commands:");
        console.log("  /quickstart          Show first-run workspace and model setup commands");
        console.log("  /setup               Initialize this workspace and optional model profile");
        console.log("  /setup --local --model name");
        console.log("  /setup --ollama --model name");
        console.log("  /setup --provider custom --base-url url --model name --api-key-env ENV");
        console.log("  /init                Initialize this workspace and optional model profile");
        console.log("  /init --local --model name");
        console.log("  /init --ollama --model name");
        console.log("  /init --provider custom --base-url url --model name --api-key-env ENV");
        console.log("  /smoke              Run the local mock smoke task");
        console.log("  /ask <task>          Ask the agent to work in the current workspace");
        console.log("  /run <task>          Run an agent task in the current workspace");
        console.log("  /status              Show workspace model and readiness status");
        console.log("  /check               Run the local readiness check");
        console.log("  /doctor              Run the local readiness check");
        console.log("  /inspect             Print the current workspace snapshot");
        console.log("  /config              Show model config and provider profiles");
        console.log("  /config path         Print the model config JSON path");
        console.log("  /providers           Show model provider presets");
        console.log("  /model               List configured model providers");
        console.log("  /model providers     Show model provider presets");
        console.log("  /model env           Print API key environment variable commands");
        console.log("  /model check         Check whether the active model profile is ready");
        console.log("  /model <provider>    Select and persist a default provider");
        console.log("  /model use <provider> Select and persist a default provider");
        console.log("  /model setup local [--model name]");
        console.log("  /model setup <provider> [--base-url url] [--model name] [--api-key-env ENV]");
        console.log("  /workspace           List recent workspaces");
        console.log("  /workspace recent    List recent workspaces");
        console.log("  /workspace <n>       Switch to the numbered recent workspace");
        console.log("  /workspace use <n|path> Switch to a recent or explicit workspace");
        console.log("  /workspace <path>    Switch workspace for later commands");
        console.log("  /exit                Quit Soloclaw");
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/quickstart") {
        printSoloclawQuickstart(await buildSoloclawQuickstart(historyRoot, workspace));
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/smoke") {
        console.log(await runSoloclawSmoke(workspace));
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/init" || line.startsWith("/init ") || line === "/setup" || line.startsWith("/setup ")) {
        const commandPrefix = line.startsWith("/setup") ? "/setup" : "/init";
        const parsedArgs = splitCliWords(line.slice(commandPrefix.length).trim());
        const result = await initializeSoloclawWorkspace(historyRoot, workspace, parsedArgs);
        printSoloclawInitView(result.view);
        profileStore = new LocalProviderProfileStore(path.join(workspace, ".agent"));
        provider = (await profileStore.getDefaultProvider()) ?? provider;
        console.log(`Model: ${provider}`);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/status") {
        printSoloclawStatus(await buildSoloclawStatus(historyRoot, workspace, provider));
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/doctor" || line === "/check") {
        const readiness = await verifyPhaseOneReadiness(workspace);
        printPhaseOneReadiness(readiness);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/inspect") {
        const snapshot = await collectWorkspaceSnapshot(workspace);
        console.log(renderWorkspaceSnapshot(snapshot));
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/config path") {
        console.log(profileStore.filePath);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/config") {
        const profiles = await profileStore.list();
        const defaultProvider = await profileStore.getDefaultProvider();
        console.log(`config=${profileStore.filePath}`);
        console.log(`active=${provider}`);
        console.log(`default=${defaultProvider ?? "-"}`);
        for (const profile of profiles) {
          console.log(`${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}`);
        }
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/providers" || line === "/model providers" || line === "/model presets") {
        const profiles = await profileStore.list();
        const defaultProvider = await profileStore.getDefaultProvider();
        printModelProviderProfiles(profiles, defaultProvider);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/model env" || line.startsWith("/model env ")) {
        const parsedArgs = splitCliWords(line.slice("/model env".length).trim());
        const result = await buildModelEnvView(workspace, parsedArgs, provider);
        printModelEnvView(result.view);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/model check" || line.startsWith("/model check ")) {
        const parsedArgs = splitCliWords(line.slice("/model check".length).trim());
        const result = await buildModelCheckView(workspace, parsedArgs, provider);
        printModelCheckView(result.view);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/model") {
        const profiles = await profileStore.list();
        const defaultProvider = await profileStore.getDefaultProvider();
        for (const profile of profiles) {
          console.log(`${profile.name}${profile.name === defaultProvider ? " *" : ""}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}`);
        }
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/model setup" || line.startsWith("/model setup ")) {
        const parsed = parseModelProfileArgs(splitCliWords(line.slice("/model setup".length).trim()));
        const providerInput = parsed.options.providerInput ?? parsed.positionals[0];
        const providerName = parsed.options.provider ?? (providerInput ? parseModelProviderName(providerInput) : undefined);
        if (!providerName) {
          console.log("Usage: /model setup <provider> [--base-url url] [--model name] [--api-key-env ENV]");
          stdout.write("soloclaw> ");
          continue;
        }
        const current = (await profileStore.list()).find((profile) => profile.name === providerName);
        if (!current) {
          throw new Error(`Unknown model provider: ${providerName}`);
        }
        const profile = await profileStore.set({
          name: providerName,
          protocol: parsed.options.protocol ?? current.protocol,
          defaultBaseUrl: parsed.options.baseUrl ?? localModelAliasBaseUrl(providerInput) ?? current.defaultBaseUrl,
          defaultModel: parsed.options.model ?? current.defaultModel,
          apiKeyEnvNames: resolveModelApiKeyEnvNames(parsed.options, providerInput, current.apiKeyEnvNames),
        });
        if (parsed.options.setDefault || parsed.options.setDefault === undefined) {
          await profileStore.setDefaultProvider(providerName);
          provider = providerName;
        }
        const defaultProvider = await profileStore.getDefaultProvider();
        console.log(`${profile.name}\t${profile.source}\t${profile.protocol}\tmodel=${profile.defaultModel}\tbaseUrl=${profile.defaultBaseUrl ?? "-"}\tenv=${profile.apiKeyEnvNames.join(",") || "-"}\tdefault=${defaultProvider ?? "-"}`);
        console.log(`config=${profileStore.filePath}`);
        console.log(`Model: ${provider}`);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line.startsWith("/model ")) {
        let modelSelector = line.slice("/model ".length).trim();
        if (modelSelector.startsWith("use ") || modelSelector.startsWith("default ")) {
          modelSelector = modelSelector.replace(/^(use|default)\s+/, "").trim();
        }
        const selected = await selectDefaultModelProvider(profileStore, modelSelector);
        provider = selected.defaultProvider;
        console.log(`Model: ${provider}`);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line === "/workspace") {
        const history = await readWorkspaceHistory(historyRoot);
        printWorkspaceHistory(history);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line.startsWith("/workspace ")) {
        let selector = line.slice("/workspace ".length).trim();
        if (selector.startsWith("use ") || selector.startsWith("select ")) {
          selector = selector.replace(/^(use|select)\s+/, "").trim();
        }
        if (selector === "recent" || selector === "list") {
          const history = await readWorkspaceHistory(historyRoot);
          printWorkspaceHistory(history);
          stdout.write("soloclaw> ");
          continue;
        }
        const nextWorkspace = await resolveWorkspaceSelector(historyRoot, selector, workspace);
        await recordWorkspaceHistoryEntry(historyRoot, nextWorkspace);
        workspace = nextWorkspace;
        profileStore = new LocalProviderProfileStore(path.join(workspace, ".agent"));
        provider = (await profileStore.getDefaultProvider()) ?? provider;
        console.log(`Workspace: ${workspace}`);
        console.log(`Model: ${provider}`);
        stdout.write("soloclaw> ");
        continue;
      }
      if (line.startsWith("/") && !line.startsWith("/run ") && !line.startsWith("/ask ")) {
        console.log(`Unknown command: ${line.split(/\s+/, 1)[0]}`);
        console.log("Type /help for commands.");
        stdout.write("soloclaw> ");
        continue;
      }
      const task = line.startsWith("/run ")
        ? line.slice("/run ".length).trim()
        : line.startsWith("/ask ")
          ? line.slice("/ask ".length).trim()
          : line;
      if (!task) {
        console.log("Usage: /run <task>");
        stdout.write("soloclaw> ");
        continue;
      }
      const platform = await createLocalPlatform(workspace, { provider, knowledgeQuery: task });
      try {
        const answer = await platform.agent.run(task);
        console.log(answer);
      } finally {
        platform.locks.close?.();
        platform.store.close();
      }
      stdout.write("soloclaw> ");
    }
  } finally {
    rl.close();
  }
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptSoloclawSetupWizardArgs(options: { json?: boolean }): Promise<string[]> {
  const wizardOutput = options.json ? process.stderr : stdout;
  wizardOutput.write("Soloclaw setup wizard\n");
  if (!stdin.isTTY) {
    wizardOutput.write("Provider [local]: ");
    wizardOutput.write("Model [default]: ");
    wizardOutput.write("Base URL [provider default]: ");
    wizardOutput.write("API key env [provider default, type none to clear]: ");
    const lines = (await readStdinText()).split(/\r?\n/);
    return buildSoloclawSetupWizardArgs(lines[0] ?? "", lines[1] ?? "", lines[2] ?? "", lines[3] ?? "", options);
  }
  const rl = createInterface({ input: stdin, output: wizardOutput });
  try {
    const providerInput = (await rl.question("Provider [local]: ")).trim() || "local";
    const model = (await rl.question("Model [default]: ")).trim() || "default";
    const baseUrl = (await rl.question("Base URL [provider default]: ")).trim();
    const apiKeyEnv = (await rl.question("API key env [provider default, type none to clear]: ")).trim();
    return buildSoloclawSetupWizardArgs(providerInput, model, baseUrl, apiKeyEnv, options);
  } finally {
    rl.close();
  }
}

function buildSoloclawSetupWizardArgs(providerInput: string, modelInput: string, baseUrlInput: string, apiKeyEnvInput: string, options: { json?: boolean }): string[] {
  const provider = providerInput.trim() || "local";
  const model = modelInput.trim() || "default";
  const args = [provider, "--model", model];
  const baseUrl = baseUrlInput.trim();
  if (baseUrl) {
    args.push("--base-url", baseUrl);
  }
  if (apiKeyEnvInput.trim().toLowerCase() === "none") {
    args.push("--clear-api-key-envs");
    if (options.json) {
      args.push("--json");
    }
    return args;
  }
  for (const envName of apiKeyEnvInput.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    args.push("--api-key-env", envName);
  }
  if (options.json) {
    args.push("--json");
  }
  return args;
}

async function readStdinText(): Promise<string> {
  let raw = "";
  for await (const chunk of stdin) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  return raw;
}

type ModelProfileCliOptions = {
  json?: boolean;
  wizard?: boolean;
  provider?: ModelProviderName;
  providerInput?: string;
  protocol?: "openai_chat" | "anthropic_messages" | "mock";
  baseUrl?: string;
  model?: string;
  apiKeyEnvNames?: string[];
  clearApiKeyEnvNames?: boolean;
  setDefault?: boolean;
};

type ModelUsageCliOptions = {
  json?: boolean;
  provider?: string;
  model?: string;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

type McpCliOptions = {
  json?: boolean;
  name?: string;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  inputJson?: string;
  inputFile?: string;
  timeoutMs?: number;
  secretEnvMap?: Record<string, string>;
  envVarNames?: string[];
  capabilities?: string[];
  enabled?: boolean;
  requireApproval?: boolean;
  risk?: TaskRisk;
  allowedProjects?: string[];
  allowedRooms?: string[];
  scopeProjectId?: string;
  scopeRoomId?: string;
  executionMode?: ExecutionMode;
};

function parseModelProfileArgs(args: string[]): { options: ModelProfileCliOptions; positionals: string[] } {
  const options: ModelProfileCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--wizard") {
      options.wizard = true;
      continue;
    }
    if (arg === "--provider" && next) {
      options.providerInput = next;
      options.provider = parseModelProviderName(next);
      index += 1;
      continue;
    }
    if (arg === "--local" || arg === "--ollama" || arg === "--mock" || arg === "--custom") {
      const providerInput = arg.slice(2);
      options.providerInput = providerInput;
      options.provider = parseModelProviderName(providerInput);
      continue;
    }
    if (arg === "--protocol" && next) {
      if (next !== "openai_chat" && next !== "anthropic_messages" && next !== "mock") {
        throw new Error("--protocol must be openai_chat, anthropic_messages, or mock.");
      }
      options.protocol = next;
      index += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      index += 1;
      continue;
    }
    if ((arg === "--model" || arg === "--default-model") && next) {
      options.model = next;
      index += 1;
      continue;
    }
    if (arg === "--api-key-env" && next) {
      options.apiKeyEnvNames = [...(options.apiKeyEnvNames ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--clear-api-key-envs") {
      options.clearApiKeyEnvNames = true;
      continue;
    }
    if (arg === "--default") {
      options.setDefault = true;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

function parseModelUsageArgs(args: string[]): { options: ModelUsageCliOptions; filters: Omit<ListAuditEventsInput, "type"> } {
  const options: ModelUsageCliOptions = {};
  const filters: Omit<ListAuditEventsInput, "type"> = { limit: 1000 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--provider" && next) {
      options.provider = next;
      index += 1;
      continue;
    }
    if (arg === "--model" && next) {
      options.model = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      filters.limit = parsePositiveInteger(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--session" && next) {
      filters.sessionId = next as ListAuditEventsInput["sessionId"];
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      filters.roomId = next as ListAuditEventsInput["roomId"];
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      filters.projectId = next as ListAuditEventsInput["projectId"];
      index += 1;
      continue;
    }
    if (arg === "--from" && next) {
      filters.from = next;
      index += 1;
      continue;
    }
    if (arg === "--to" && next) {
      filters.to = next;
      index += 1;
      continue;
    }
    if (arg === "--input-cost-per-mtok" && next) {
      options.inputCostPerMillionTokens = parseNonNegativeNumber(next, "--input-cost-per-mtok");
      index += 1;
      continue;
    }
    if (arg === "--output-cost-per-mtok" && next) {
      options.outputCostPerMillionTokens = parseNonNegativeNumber(next, "--output-cost-per-mtok");
      index += 1;
      continue;
    }
  }
  return { options, filters };
}

function parseMcpArgs(args: string[]): { options: McpCliOptions; positionals: string[] } {
  const options: McpCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--name" && next) {
      options.name = next;
      index += 1;
      continue;
    }
    if (arg === "--transport" && next) {
      if (next !== "stdio" && next !== "http") {
        throw new Error("--transport must be stdio or http.");
      }
      options.transport = next;
      index += 1;
      continue;
    }
    if (arg === "--command" && next) {
      options.command = next;
      index += 1;
      continue;
    }
    if (arg === "--arg" && next) {
      options.args = [...(options.args ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--url" && next) {
      options.url = next;
      index += 1;
      continue;
    }
    if (arg === "--input-json" && next) {
      options.inputJson = next;
      index += 1;
      continue;
    }
    if ((arg === "--input-file" || arg === "--file") && next) {
      options.inputFile = next;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      options.timeoutMs = parsePositiveInteger(next, "--timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--secret-env" && next) {
      const [envName, secretId] = next.split("=", 2);
      if (!envName || !secretId) {
        throw new Error("--secret-env must be NAME=secret-ref.");
      }
      options.secretEnvMap = { ...(options.secretEnvMap ?? {}), [envName]: secretId };
      index += 1;
      continue;
    }
    if ((arg === "--env-var" || arg === "--env") && next) {
      options.envVarNames = [...(options.envVarNames ?? []), next];
      index += 1;
      continue;
    }
    if ((arg === "--cap" || arg === "--capability") && next) {
      options.capabilities = [...(options.capabilities ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--risk" && next) {
      options.risk = parseTaskRisk(next);
      index += 1;
      continue;
    }
    if (arg === "--execution-mode" && next) {
      options.executionMode = parseExecutionMode(next);
      index += 1;
      continue;
    }
    if (arg === "--no-approval") {
      options.requireApproval = false;
      continue;
    }
    if (arg === "--require-approval") {
      options.requireApproval = true;
      continue;
    }
    if (arg === "--disabled") {
      options.enabled = false;
      continue;
    }
    if (arg === "--enabled") {
      options.enabled = true;
      continue;
    }
    if (arg === "--project" && next) {
      options.allowedProjects = [...(options.allowedProjects ?? []), next];
      options.scopeProjectId = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      options.allowedRooms = [...(options.allowedRooms ?? []), next];
      options.scopeRoomId = next;
      index += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

function parseTaskRisk(value: string): TaskRisk {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  throw new Error(`Invalid risk: ${value}. Expected low, medium, high, or critical.`);
}

function parseExecutionMode(value: string): ExecutionMode {
  if (value === "strict" || value === "balanced" || value === "trusted" || value === "full_access") {
    return value;
  }
  throw new Error(`Invalid execution mode: ${value}. Expected strict, balanced, trusted, or full_access.`);
}

function formatModelUsageEntry(entry: ModelUsageSummaryEntry): string {
  return `${entry.provider}\t${entry.model}\t${formatModelUsageStats(entry)}`;
}

function formatModelUsageStats(entry: Omit<ModelUsageSummaryEntry, "provider" | "model">): string {
  const parts = [
    `calls=${entry.calls}`,
    `ok=${entry.successfulCalls}`,
    `failed=${entry.failedCalls}`,
    `withUsage=${entry.callsWithUsage}`,
    `prompt=${entry.promptTokens}`,
    `completion=${entry.completionTokens}`,
    `total=${entry.totalTokens}`,
    `durationMs=${entry.durationMs}`,
  ];
  if (entry.estimatedCost !== undefined) {
    parts.push(`estimatedCost=${entry.estimatedCost.toFixed(6)}`);
  }
  return parts.join("\t");
}

function formatMcpServer(server: McpServerRegistration): string {
  const endpoint = server.transport === "stdio" ? `command=${server.command ?? "-"}` : `url=${server.url ?? "-"}`;
  return [
    server.id,
    server.transport,
    server.policy.enabled ? "enabled" : "disabled",
    `risk=${server.policy.risk}`,
    `approval=${server.policy.requireApproval ? "required" : "not_required"}`,
    `caps=${server.capabilities.join(",") || "-"}`,
    `env=${server.envVarNames.join(",") || "-"}`,
    endpoint,
    server.name,
  ].join("\t");
}

function formatMcpConnectionPlan(plan: McpConnectionPlan): string {
  const endpoint = plan.connection.transport === "stdio" ? `command=${plan.connection.command ?? "-"}` : `url=${plan.connection.url ?? "-"}`;
  return [
    plan.server.id,
    plan.status,
    `reason=${plan.reason}`,
    `risk=${plan.server.policy.risk}`,
    `approval=${plan.server.policy.requireApproval ? "required" : "not_required"}`,
    `caps=${plan.server.capabilities.join(",") || "-"}`,
    `env=${plan.connection.envVarNames.join(",") || "-"}`,
    `project=${plan.scope.projectId ?? "-"}`,
    `room=${plan.scope.roomId ?? "-"}`,
    endpoint,
  ].join("\t");
}

function createMcpExecutionService(registry: LocalMcpRegistry, platform: Awaited<ReturnType<typeof createLocalPlatform>>): McpExecutionService {
  return new McpExecutionService(
    registry,
    new LocalMcpRuntime({ redactor: platform.redactor }),
    platform.policy,
    platform.store,
    platform.secretBroker,
  );
}

function createMcpHealthService(registry: LocalMcpRegistry, platform: Awaited<ReturnType<typeof createLocalPlatform>>): McpHealthService {
  return new McpHealthService(
    registry,
    new LocalMcpRuntime({ redactor: platform.redactor }),
    platform.policy,
    platform.store,
    platform.secretBroker,
  );
}

function formatMcpExecutionResult(result: McpExecutionResult): string {
  const lines = [
    `server=${result.plan.server.id}\toperation=${result.operation}\ttransport=${result.plan.server.transport}`,
  ];
  if (result.capabilities) {
    lines.push(`tools=${result.capabilities.tools.map((tool) => tool.name).join(",") || "-"}`);
    lines.push(`resources=${result.capabilities.resources.map((resource) => resource.uri).join(",") || "-"}`);
  }
  if (result.tool) {
    lines.push(`tool_ok=${result.tool.ok}\toutput_length=${result.tool.output?.length ?? 0}`);
    if (result.tool.error) {
      lines.push(`tool_error=${result.tool.error.code}:${result.tool.error.message}`);
    }
    if (result.tool.output) {
      lines.push(result.tool.output);
    }
  }
  if (result.resource) {
    lines.push(`resource=${result.resource.uri}\tmime=${result.resource.mimeType ?? "-"}\ttext_length=${result.resource.text?.length ?? 0}\tblob=${result.resource.blob ? "yes" : "no"}`);
    if (result.resource.text) {
      lines.push(result.resource.text);
    }
  }
  return lines.join("\n");
}

function formatMcpHealthResult(result: McpHealthCheckResult): string {
  return [
    result.serverId,
    result.status,
    `transport=${result.transport ?? "-"}`,
    `tools=${result.capabilities?.tools ?? "-"}`,
    `resources=${result.capabilities?.resources ?? "-"}`,
    `reason=${result.reason ?? result.plan?.reason ?? "-"}`,
  ].join("\t");
}

async function readJsonObjectInput(inputJson?: string, inputFile?: string): Promise<Record<string, unknown>> {
  const raw = inputFile ? await readUtf8(inputFile) : inputJson ?? "{}";
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("MCP tool input must be a JSON object.");
  }
  return parsed;
}

function safeMcpAuditMetadata(server: McpServerRegistration): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    hasCommand: Boolean(server.command),
    hasUrl: Boolean(server.url),
    envVarNames: server.envVarNames,
    capabilities: server.capabilities,
    policy: server.policy,
  };
}

function isMcpApprovalAction(action: PolicyAction): boolean {
  return action === "mcp.connect" || action === "mcp.tool.call" || action === "mcp.resource.read";
}

function parseModelProviderName(value: string): ModelProviderName {
  if (value === "custom" || value === "local" || value === "ollama") {
    return "openai_compatible";
  }
  if (
    value === "openai" ||
    value === "grok" ||
    value === "anthropic" ||
    value === "minimax" ||
    value === "deepseek" ||
    value === "glm" ||
    value === "mimo" ||
    value === "openai_compatible" ||
    value === "anthropic_compatible" ||
    value === "mock"
  ) {
    return value;
  }
  throw new Error(`Unknown model provider: ${value}.`);
}

function tryParseModelProviderName(value: string): ModelProviderName | undefined {
  try {
    return parseModelProviderName(value);
  } catch {
    return undefined;
  }
}

function localModelAliasBaseUrl(value: string | undefined): string | undefined {
  return value === "local" || value === "ollama" ? "http://localhost:11434/v1" : undefined;
}

function resolveModelApiKeyEnvNames(options: ModelProfileCliOptions, providerInput: string | undefined, currentEnvNames: string[]): string[] {
  if (options.clearApiKeyEnvNames) {
    return [];
  }
  if (options.apiKeyEnvNames) {
    return options.apiKeyEnvNames;
  }
  return localModelAliasBaseUrl(providerInput) ? [] : currentEnvNames;
}

function printHelp(args: string[] = []) {
  if (args.includes("--all")) {
    printFullHelp();
    return;
  }
  console.log(`Soloclaw

Primary command: soloclaw
Compatibility alias: agent

Start here:
  soloclaw                                      Open the local terminal workspace
  soloclaw --workspace path                     Open the terminal workspace for a target project
  soloclaw quickstart [--workspace path]        Print first-run setup steps
  soloclaw setup --wizard [--workspace path]    Configure a model interactively
  soloclaw setup --local --model <model>        Configure local/Ollama-style OpenAI-compatible model
  soloclaw ask "inspect this workspace"         Run a mock-safe project-reading task
  soloclaw smoke                                Run the local mock smoke task
  soloclaw doctor [--json]                      Check Phase 1 readiness

Everyday commands:
  soloclaw status [--json]                      Show active workspace, model, and readiness
  soloclaw workspace list|add|use               Manage recent and active workspaces
  soloclaw providers [--json]                   List built-in provider defaults
  soloclaw model list|env|check|use|setup       View and configure model profiles
  soloclaw config path|show [--json]            Locate or inspect editable JSON config
  soloclaw inspect [--json]                     Show the project context the agent sees
  soloclaw run|plan|build|goal "task"           Use advanced local task modes

Model setup examples:
  soloclaw setup --wizard
  soloclaw setup --workspace ../project --mock
  soloclaw setup --mock
  soloclaw setup --local --model qwen-local
  soloclaw setup --provider custom --base-url http://localhost:11434/v1 --model qwen-local --api-key-env LOCAL_LLM_API_KEY

Config:
  Workspace history: .agent/workspaces.json
  Model profiles:   .agent/model-providers.json
  Secrets:          store environment variable names or secret refs, not raw keys

More:
  soloclaw help --all                           Show the full compatibility command reference
  agent help --all                              Same full reference through the compatibility alias
`);
}

function printFullHelp() {
  console.log(`Soloclaw

Primary command: soloclaw
Compatibility alias: agent

Usage:
  soloclaw
  soloclaw quickstart [--workspace path] [--json]
  soloclaw setup --wizard [--workspace path]
  soloclaw setup [--workspace path] [--local|--ollama|--mock|--custom|--provider provider] [--base-url url] [--model model] [--api-key-env ENV] [--json]
  soloclaw init [--workspace path] [--local|--ollama|--mock|--custom|--provider provider] [--base-url url] [--model model] [--api-key-env ENV] [--json]
  soloclaw tui [--workspace path]
  soloclaw status [--workspace path] [--json]
  soloclaw smoke [--workspace path]
  soloclaw check [--workspace path] [--json]
  soloclaw doctor [--workspace path] [--json]
  soloclaw providers [--workspace path] [--json]
  soloclaw ask [--workspace path] "your task"
  soloclaw workspace list [--json]
  soloclaw workspace add path
  soloclaw workspace use number|path   # set the active workspace opened by soloclaw
  soloclaw model list [--workspace path] [--json]
  soloclaw model providers [--workspace path] [--json]
  soloclaw model env [--workspace path] [provider] [--json]
  soloclaw model check [--workspace path] [--json] [--provider provider]
  soloclaw model provider
  soloclaw model use provider
  soloclaw model setup [--workspace path] --provider provider [--base-url url] [--model model] [--api-key-env ENV] [--default]
  soloclaw model setup [--workspace path] local --model model
  soloclaw model setup [--workspace path] custom --base-url url --model model --api-key-env ENV
  soloclaw config path [--workspace path]
  soloclaw config show [--workspace path] [--json]
  soloclaw models setup --provider provider [--base-url url] [--model model] [--api-key-env ENV] [--default]
  soloclaw run [same options as agent run] "your task"
  agent run [--workspace path] [--json] [--session-result] [--verify-session] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-execution-profile local-safe|local-workspace-write|local-network|local-full-access] [--require-approval-action action] [--allow-no-command] [--target-mode plan|build|goal] [--spec spec-id] [--provider mock|openai|anthropic|grok|minimax|deepseek|glm|mimo|openai_compatible|anthropic_compatible] [--model model] [--base-url url] [--api-key-env env] [--api-key-secret secret-id] [--fallback-provider provider] [--model-retries n] [--model-retry-base-ms n] [--model-retry-max-ms n] [--model-call-budget n] [--model-failure-budget n] [--model-circuit-break-after n] [--model-circuit-open-ms n] [--execution-mode trusted|balanced|strict|full_access] [--org org-id] [--project project-id] [--room room-id] [--skill name] [--no-workspace-snapshot] [--include-key-files] [--max-key-files n] [--max-preview-lines n] [--max-preview-chars n] [--knowledge-scope project] [--knowledge-id local] [--knowledge-enforce-acl] [--knowledge-safety off|annotate|exclude] "your task"
  agent plan "your task"
  agent build "your task"
  agent goal [--spec spec-id] "your objective"
  agent inspect [--workspace path] [--json] [--include-key-files] [--max-key-files n] [--max-preview-lines n] [--max-preview-chars n]
  agent phase1 verify [--json]
  agent phase2 verify [--workspace path] [--json] [--cleanup]
  agent sessions [--json] [--limit n] [--status created|running|paused|cancelled|failed|completed] [--target-mode plan|build|goal]
  agent show-session <session-id>
  agent session diff <session-id> [--json]
  agent session report <session-id> [--json]
  agent session status <session-id> [--json] [--limit n]
  agent session timeline|logs <session-id> [--json] [--limit n]
  agent session review <session-id> [--json] [--limit n]
  agent session bundle <session-id> [--json] [--output path] [--limit n] [verification options]
  agent session result <session-id> [--json]
  agent session verify <session-id> [--json] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-execution-profile profile] [--require-approval-action action] [--allow-no-command]
  agent resume <session-id> [--workspace path] [--json] [--session-result] [--verify-session] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-execution-profile profile] [--require-approval-action action] [--allow-no-command]
  agent pause <session-id> [reason]
  agent cancel <session-id> [reason]
  agent identity show
  agent agents [--limit n]
  agent agents health [--now iso-timestamp] [--limit n] [--json]
  agent operator status [--kind kind] [--status status] [--severity ok|info|warning|critical] [--id item-or-ref-id] [--details] [--rows] [--public] [--actor user:id|agent:id] [--limit n] [--json]
  agent operator show <item-id-or-ref-id>|--select n [--kind kind] [--status status] [--severity severity] [--public] [--actor user:id|agent:id] [--json]
  agent remote enroll --control-url url [--control-token token] --room room-id --invite-token token [--alias alias] [--display-name name] [--json]
  agent remote inbox --control-url url [--control-token token] --room room-id [--limit n] [--include-delivered] [--json]
  agent remote ack --control-url url [--control-token token] --room room-id [--message-id message-id] [--json]
  agent remote poll --control-url url [--control-token token] --room room-id [--limit n] [--idle-limit n] [--interval-ms n] [--json]
  agent remote heartbeat --control-url url [--control-token token] --room room-id [--status online|idle|running|error|offline] [--ttl seconds] [--last-error text] [--json]
  agent remote run --control-url url [--control-token token] --room room-id [--cycles n] [--limit n] [--idle-limit n] [--interval-ms n] [--loop-interval-ms n] [--stop-when-idle] [--idle-cycles n] [--backoff-ms n] [--max-backoff-ms n] [--max-errors n] [--heartbeat-ttl seconds] [--json]
  agent workers register [--display-name name] [--endpoint url] [--cap capability] [--project project-id] [--max-tasks n] [--ttl seconds]
  agent workers heartbeat <worker-id> [--status online|offline|draining|suspended] [--load n] [--max-tasks n] [--ttl seconds]
  agent workers drain <worker-id> [reason] [--ttl seconds]
  agent workers complete-drain <worker-id> [reason]
  agent workers verify-heartbeat <worker-id>
  agent workers recover-expired [--limit n]
  agent workers cleanup-nonces [--before iso-timestamp] [--limit n]
  agent workers health [--now iso-timestamp] [--limit n]
  agent workers run-once <worker-id> [--ttl seconds] [--require-signed-lease]
  agent workers poll <worker-id> [--limit n] [--idle-limit n] [--interval-ms n] [--ttl seconds] [--require-signed-lease]
  agent workers list [--status online|offline|draining|suspended] [--agent agent-id] [--machine machine-id] [--org org-id] [--project project-id] [--limit n]
  agent scheduler tick [--worker worker-id] [--require-signed-heartbeat] [--require-signed-lease] [--complete-drained-workers] [--warn-load-ratio n] [--warn-queue-ratio n] [--dispatch-spec spec-id] [--dispatch-limit n] [--dispatch-worker worker-id|--dispatch-auto-select-worker] [--dispatch-max-load-ratio n] [--dispatch-max-queued-per-worker n] [--runs-per-worker n] [--recover-limit n] [--max-attempts n] [--backoff-ms n] [--max-backoff-ms n] [--jitter-ms n] [--ttl seconds]
  agent scheduler run [--interval-ms n] [--max-ticks n] [--stop-when-idle] [--idle-ticks n] [same tick options]
  agent assignments assign-session <session-id> --worker worker-id [--ttl seconds] [--priority n]
  agent assignments assign-subtask <subtask-id> --worker worker-id [--ttl seconds] [--priority n]
  agent assignments heartbeat <assignment-id> --worker worker-id [--ttl seconds]
  agent assignments complete|fail|cancel <assignment-id> --worker worker-id [summary]
  agent assignments recover-expired [--retry-worker worker-id|--auto-select-worker] [--max-attempts n] [--backoff-ms n] [--max-backoff-ms n] [--jitter-ms n] [--ttl seconds] [--limit n] [--exhausted-status paused|failed]
  agent assignments cleanup-nonces [--before iso-timestamp] [--limit n]
  agent assignments list [--status leased|running|paused|completed|failed|cancelled|expired] [--worker worker-id] [--session session-id] [--subtask subtask-id]
  agent orgs create <name>
  agent orgs list
  agent orgs project-create <org-id> [--default-role viewer|member|admin] <name>
  agent orgs projects [org-id]
  agent orgs grant <organization|project|room|session|operator> <scope-id> <user:id|agent:id|service_account:id> <capability> [--expires-at iso]
  agent orgs grants [--scope-type type] [--scope-id id] [--subject user:id|agent:id]
  agent orgs can <organization|project|room|session|operator> <scope-id> <user:id|agent:id|service_account:id> <capability>
  agent retention create <name> [--hot-days n] [--artifact-days n] [--audit-days n] [--no-auto-summaries] [--no-user-delete] [--no-audit-export]
  agent retention list
  agent retention assign <project-id> <policy-id>
  agent retention apply <project-id>
  agent git status [--remote origin]
  agent pr prepare --title title [--body text|--body-file file] [--branch branch] [--base main] [--provider github|gitlab] [--commit] [--push] [--apply]
  agent secrets put <name> --class model_api_key --scope-type workspace --scope-id local --value-env ENV_NAME
  agent secrets list
  agent secrets get <secret-id> [--purpose text] [--reveal] [--execution-mode strict|balanced|trusted|full_access]
  agent secrets delete <secret-id>
  agent models usage [--provider provider] [--model model] [--project id] [--session id] [--room id] [--from iso] [--to iso] [--limit n] [--input-cost-per-mtok n] [--output-cost-per-mtok n] [--json]
  agent model list [--json]
  agent model use <provider>
  agent model setup --provider provider [--base-url url] [--model model] [--api-key-env ENV] [--default]
  agent config path
  agent config show [--json]
  agent models setup --provider provider [--base-url url] [--model model] [--api-key-env ENV] [--default]
  agent models profiles list [--json]
  agent models profiles set <provider> [--protocol openai_chat|anthropic_messages] [--base-url url] [--model model] [--api-key-env ENV] [--default]
  agent models profiles remove <provider>
  agent mcp list [--json]
  agent mcp register <server-id> --transport stdio|http [--name name] [--command cmd|--url url] [--arg value] [--env-var NAME] [--cap tools|resources|prompts|sampling] [--risk low|medium|high|critical] [--no-approval] [--disabled] [--project id] [--room id]
  agent mcp plan <server-id> [--execution-mode strict|balanced|trusted|full_access] [--project id] [--room id] [--json]
  agent mcp health <server-id> [--execution-mode trusted|full_access] [--project id] [--room id] [--timeout-ms n] [--secret-env NAME=sec_xxxxxxxx] [--json]
  agent mcp capabilities <server-id> [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]
  agent mcp call-tool <server-id> <tool-name> [--input-json '{...}'|--input-file file.json] [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]
  agent mcp read-resource <server-id> <uri> [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]
  agent mcp show <server-id>
  agent mcp remove <server-id>
  agent rooms create [--join-policy manual|invite_token|fingerprint_allowlist] [--alias alias] [--agent-response broadcast|mentions_only] [--wide-mention-policy disabled|moderators|members] [--max-routed-agent-targets n] [--require-signed-invites] [--allow-fingerprint fingerprint] [--allow-local-agent] <name>
  agent rooms list
  agent rooms show <room-id>
  agent rooms inbox <room-id> [--agent-id agent-id|--local-agent] [--limit n] [--include-delivered] [--json]
  agent rooms inbox-ack <room-id> [--agent-id agent-id|--local-agent] [--message-id message-id] [--json]
  agent rooms verify <room-id>
  agent rooms invite <room-id> [--local-agent|--actor user:id|agent:id] [--role participant|observer|executor|reviewer|approver] [--ttl-hours n] [--max-uses n]
  agent rooms invites <room-id>
  agent rooms revoke-invite <room-id> <invite-id> [--local-agent|--actor user:id|agent:id]
  agent rooms join <room-id> [--invite-token token] [--alias alias] [--local-agent|--actor user:id|agent:id] [--role participant|observer|executor|reviewer|approver]
  agent rooms approve <room-id> <actor-id> [--local-agent|--actor user:id|agent:id]
  agent rooms alias <room-id> <actor-id> [--alias alias] [--local-agent|--actor user:id|agent:id]
  agent rooms role <room-id> <actor-id> <owner|moderator|participant|observer|executor|reviewer|approver> [--local-agent|--actor user:id|agent:id]
  agent rooms status <room-id> <actor-id> <invited|pending|active|suspended|left|removed|expired> [--local-agent|--actor user:id|agent:id]
  agent rooms say <room-id> [--local-agent|--actor user:id|agent:id] [--kind chat|task|decision|tool_request|approval|artifact|system] <message with optional @alias|@agent:id|@role:role|@all>
  agent tool run_command [--execution-mode strict|balanced|trusted|full_access] [--org org-id] [--project project-id] [--room room-id] "npm test"
  agent tool apply_patch [--execution-mode strict|balanced|trusted|full_access] <unified-diff>
  agent approvals [pending|approved|denied]
  agent approve <approval-id> [--local-agent|--actor user:id|agent:id] [--auto-replay] [--auto-resume|--queue-resume worker-id] [reason]
  agent deny <approval-id> [--local-agent|--actor user:id|agent:id] [reason]
  agent replay <approval-id>
  agent delegate [--parent-session session-id] [--room room-id] [--assigned-agent agent-id] "subtask objective"
  agent subtasks [parent-session-id]
  agent skills load|list|show
  agent plugins list
  agent plugins show <plugin-name|plugin.tool.name>
  agent plugins run <plugin.tool.name> [--execution-mode strict|balanced|trusted|full_access] [--room room-id] [--input-file file] [json-input]
  agent memory add <scope-type> <scope-id> <kind> <content>
  agent memory list [scope-type] [scope-id]
  agent memory delete <memory-id>
  agent memory summary <session-id> <summary>
  agent spec create [--title title] [--org org-id] [--project project-id] [--room room-id] <objective>
  agent spec list [--org org-id] [--project project-id] [--room room-id] [--status draft|planned|ready|in_progress|completed|blocked|archived]
  agent spec show <spec-id>
  agent spec version <spec-id> [--reason text] [--json]
  agent spec versions <spec-id> [--limit n] [--json]
  agent spec diff <spec-id> [--from version-id-or-number] [--to version-id-or-number|current] [--save-artifact] [--artifact-name name] [--json]
  agent spec plan <spec-id> [--version version-id] [--title title] [--summary text] [--status draft|active] [--json]
  agent spec plans <spec-id> [--status draft|active|superseded|archived] [--limit n] [--json]
  agent spec request-plan-approval <spec-id> <plan-id> [reason]
  agent spec clarify <spec-id> <question>
  agent spec clarifications <spec-id> [--status open|answered|resolved] [--limit n] [--json]
  agent spec answer <spec-id> <clarification-id> [--resolve] <answer>
  agent spec task <spec-id> [--path path] [--depends-on task-id] [--parallel] [--verify text] <title>
  agent spec tasks <spec-id>
  agent spec validate <spec-id> [--json]
  agent spec next <spec-id> [--limit n] [--json]
  agent spec status <spec-id> <task-id> pending|in_progress|completed|blocked
  agent spec verify <spec-id> <task-id> passed|failed [--artifact artifact-id] <evidence>
  agent spec evidence <spec-id> <task-id> --provider github|gitlab|generic --conclusion success|failure|cancelled|skipped|neutral|timed_out|action_required [--check name] [--run-id id] [--url url] [--sha sha] [--branch branch] [--external-id id]
  agent spec verifications <spec-id> [task-id] [--verification-status passed|failed] [--limit n] [--json]
  agent spec delegate <spec-id> <task-id> [--room room-id] [--assigned-agent agent-id] [--execution-mode trusted|balanced|strict|full_access] [--risk low|medium|high|critical]
  agent spec dispatch <spec-id> (--worker worker-id|--auto-select-worker) [--plan plan-id] [--require-plan-approval] [--required-plan-approvals n] [--limit n] [--max-load-ratio n] [--max-queued-per-worker n] [--ttl seconds] [--priority n] [--room room-id] [--assigned-agent agent-id]
    (delegate requires every --depends-on task to be completed)
  agent knowledge ingest [--file path] [--name name] [--scope-type project] [--scope-id local] [--kind manual|file|url|repository|mcp|memory] [--trust trusted|reviewed|untrusted] <text>
  agent knowledge list [--scope-type project] [--scope-id local] [--kind kind] [--limit n]
  agent knowledge search [--scope-type project] [--scope-id local] [--source source-id] [--limit n] [--enforce-acl] [--safety off|annotate|exclude] <query>
  agent knowledge eval-set create --file eval.json --name name
  agent knowledge eval-sets [--scope-type project] [--scope-id local] [--limit n]
  agent knowledge eval --file eval.json|--eval-set eval-set-id [--scope-type project] [--scope-id local] [--limit n] [--min-recall n] [--min-mrr n] [--max-empty-rate n] [--min-citation-precision n] [--max-permission-leak-rate n] [--enforce-acl] [--safety off|annotate|exclude] [--save-run] [--save-artifact] [--artifact-name name] [--json]
  agent knowledge eval-runs [--eval-set eval-set-id] [--scope-type project] [--scope-id local] [--limit n]
  agent knowledge eval-trend [--eval-set eval-set-id] [--scope-type project] [--scope-id local] [--limit n] [--regression-tolerance n] [--save-artifact] [--artifact-name name] [--json]
  agent changes [session-id]
  agent session diff <session-id> [--json]
  agent session report <session-id> [--json]
  agent session status <session-id> [--json] [--limit n]
  agent session timeline|logs <session-id> [--json] [--limit n]
  agent session review <session-id> [--json] [--limit n]
  agent session bundle <session-id> [--json] [--output path] [--limit n] [verification options]
  agent session result <session-id> [--json]
  agent session verify <session-id> [--json] [--require-change] [--require-patch] [--require-recovery] [--require-timeout] [--require-diff-stat] [--require-execution-profile profile] [--require-approval-action action] [--allow-no-command]
  agent artifacts add <path> [--kind kind] [--name name] [--project id] [--session id] [--room id]
  agent artifacts list [--project id] [--session id] [--status active|deleted]
  agent artifacts delete <artifact-id> [--delete-file] [--force]
  agent session compact <session-id> [--summary text] [--force]
  agent session delete <session-id> [--force]
  agent audit list [--limit n] [--type type] [--actor actor-id] [--session session-id] [--room room-id] [--project project-id] [--from iso] [--to iso]
  agent audit export [--format jsonl|json|bundle] [--output path] [same filters]
  agent audit verify <bundle-path>
  agent operator status [--kind kind] [--status status] [--severity ok|info|warning|critical] [--id item-or-ref-id] [--details] [--rows] [--public] [--actor user:id|agent:id] [--limit n] [--json]
  agent operator show <item-id-or-ref-id>|--select n [--kind kind] [--status status] [--severity severity] [--public] [--actor user:id|agent:id] [--json]
  agent hygiene check [--json]
  agent web [--host 127.0.0.1] [--port 4317] [--token token]

Examples:
  agent plan "add GitLab MR automation"
  agent build "fix the current failing test"
  agent goal "finish the production RAG retrieval alpha"
  agent inspect
  agent inspect --include-key-files --max-key-files 3 --max-preview-lines 30
  agent phase1 verify
  agent phase2 verify
  agent run "inspect this workspace"
  agent run --target-mode goal "finish this task end to end"
  agent run "fix the failing tests"
  agent run --json --session-result "inspect this workspace"
  agent run --verify-session --allow-no-command "inspect this workspace"
  agent run --project proj_xxxxxxxx "fix the failing tests"
  agent run --provider openai --model gpt-4o-mini "explain this project"
  agent run --provider deepseek --api-key-env DEEPSEEK_API_KEY "inspect this workspace"
  agent run --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-secret sec_xxxxxxxx "inspect this workspace"
  agent run --provider openai_compatible --base-url http://localhost:8000/v1 --api-key-env MY_API_KEY "inspect this workspace"
  agent run --provider openai_compatible --base-url http://localhost:8000/v1 --fallback-provider mock --model-retries 2 "inspect this workspace"
  agent run --target-mode goal --model-call-budget 20 --model-circuit-break-after 3 "finish this bounded task"
  agent models usage --provider openai --json
  agent models profiles set openai_compatible --base-url http://localhost:8000/v1 --model llama-local --api-key-env LOCAL_LLM_API_KEY
  agent sessions --json --limit 5
  agent session diff sess_xxxxxxxx
  agent session report sess_xxxxxxxx --json
  agent session status sess_xxxxxxxx
  agent session timeline sess_xxxxxxxx --limit 20
  agent session review sess_xxxxxxxx
  agent session bundle sess_xxxxxxxx --json --output .agent/tmp/session-bundle.json
  agent session result sess_xxxxxxxx
  agent session verify sess_xxxxxxxx --require-change --require-patch
  agent resume sess_xxxxxxxx --verify-session --allow-no-command
  agent pause sess_xxxxxxxx "waiting for approval"
  agent cancel sess_xxxxxxxx "no longer needed"
  agent identity show
  agent agents
  agent agents health --json
  agent operator status --limit 3
  agent operator status --kind spec --status blocked --details
  agent operator status --public --json
  agent operator status --actor user:viewer --json
  agent operator status --rows --json
  agent operator show --kind queue --select 1 --json
  agent operator show queue:local --json
  agent remote enroll --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --invite-token rinv_xxxxxxxx --alias builder
  agent remote inbox --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --json
  agent remote ack --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx
  agent remote poll --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --limit 5 --idle-limit 1
  agent remote heartbeat --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --status online
  agent remote run --control-url http://127.0.0.1:4317 --control-token local-dev-token --room room_xxxxxxxx --cycles 100 --stop-when-idle --idle-cycles 3 --heartbeat-ttl 60
  agent workers register --display-name "Local Worker" --cap workspace.exec --project proj_xxxxxxxx
  agent workers run-once worker_xxxxxxxx
  agent workers poll worker_xxxxxxxx --limit 5 --idle-limit 1
  agent workers list --status online
  agent scheduler tick --runs-per-worker 1 --backoff-ms 1000 --max-backoff-ms 60000
  agent scheduler tick --dispatch-spec spec_xxxxxxxx --dispatch-limit 2 --runs-per-worker 1
  agent scheduler run --interval-ms 1000 --max-ticks 10 --stop-when-idle
  agent assignments assign-session sess_xxxxxxxx --worker worker_xxxxxxxx
  agent assignments heartbeat assign_xxxxxxxx --worker worker_xxxxxxxx
  agent assignments recover-expired --retry-worker worker_xxxxxxxx --max-attempts 3
  agent assignments recover-expired --auto-select-worker --backoff-ms 1000 --max-backoff-ms 60000 --jitter-ms 250
  agent orgs create "Local Team"
  agent orgs grant project proj_xxxxxxxx agent:builder tool.approve
  agent retention create "local 30/90/365"
  agent retention assign proj_xxxxxxxx ret_xxxxxxxx
  agent retention apply proj_xxxxxxxx
  agent git status
  agent pr prepare --title "Improve agent loop" --branch agent/improve-loop
  agent secrets put openai-dev --class model_api_key --scope-type workspace --scope-id local --value-env OPENAI_API_KEY
  agent rooms create "release review"
  agent rooms create --join-policy fingerprint_allowlist --allow-local-agent "trusted local room"
  agent rooms create --join-policy invite_token --require-signed-invites "signed admission"
  agent rooms invite room_xxxxxxxx --ttl-hours 12
  agent rooms revoke-invite room_xxxxxxxx rinv_xxxxxxxx
  agent rooms join room_xxxxxxxx --actor agent:builder --role executor --alias builder
  agent rooms alias room_xxxxxxxx agent_builder --alias builder
  agent rooms approve room_xxxxxxxx builder
  agent rooms say room_xxxxxxxx "ready to coordinate"
  agent tool run_command --execution-mode strict "npm test"
  agent tool apply_patch --input-file .agent/tmp/change.patch.json
  agent tool create_file --execution-mode balanced --room room_xxxxxxxx --input-file .agent/tmp/replay-create-input.json
  agent approvals pending
  agent replay appr_xxxxxxxx
  agent approve appr_xxxxxxxx --queue-resume worker_xxxxxxxx "approved for queued continuation"
  agent delegate "inspect this workspace as a child task"
  agent delegate --room room_xxxxxxxx "inspect this workspace as a room task"
  agent skills load
  agent plugins list
  agent plugins run plugin.example.echo '{"message":"hello"}'
  agent memory add project local decision "Use SQLite for local mode and Postgres for production mode."
  agent spec create --title "RAG accuracy alpha" "Build accurate enterprise RAG with eval gates"
  agent spec task spec_xxxxxxxx --path docs/knowledge-rag.md --verify "npm test" "Define retrieval evaluation gates"
  agent spec clarify spec_xxxxxxxx "Which repositories are in scope?"
  agent spec answer spec_xxxxxxxx sclar_xxxxxxxx --resolve "Only project-alpha for phase 1."
  agent spec version spec_xxxxxxxx --reason "ready for implementation"
  agent spec diff spec_xxxxxxxx --from 1 --to current --save-artifact
  agent spec plan spec_xxxxxxxx --status active
  agent spec request-plan-approval spec_xxxxxxxx splan_xxxxxxxx "ready to dispatch"
  agent approve appr_xxxxxxxx "plan approved"
  agent spec dispatch spec_xxxxxxxx --worker worker_xxxxxxxx --plan splan_xxxxxxxx --require-plan-approval
  agent spec validate spec_xxxxxxxx
  agent spec next spec_xxxxxxxx
  agent spec verify spec_xxxxxxxx stask_xxxxxxxx passed "npm test passed"
  agent spec evidence spec_xxxxxxxx stask_xxxxxxxx --provider github --conclusion success --check ci/test --run-id 123 --url https://github.example/runs/123 --sha abc123
  agent spec verifications spec_xxxxxxxx stask_xxxxxxxx --verification-status passed
  agent spec delegate spec_xxxxxxxx stask_xxxxxxxx --assigned-agent local-agent
  agent spec dispatch spec_xxxxxxxx --worker worker_xxxxxxxx --limit 2
  agent spec dispatch spec_xxxxxxxx --auto-select-worker --limit 2
  agent goal --spec spec_xxxxxxxx "finish the planned spec tasks"
  agent knowledge ingest --file docs/knowledge-rag.md --name "RAG accuracy plan"
  agent knowledge search "how do we evaluate retrieval accuracy"
  agent knowledge eval-set create --file .agent/evals/retrieval.json --name "Retrieval regression"
  agent knowledge eval --eval-set kevalset_xxxxxxxx --limit 10 --min-recall 0.90 --save-run --save-artifact
  agent knowledge eval-trend --eval-set kevalset_xxxxxxxx --limit 20 --save-artifact
  agent artifacts add .agent/tmp/audit-export.jsonl --kind report --project proj_xxxxxxxx
  agent session compact sess_xxxxxxxx
  agent hygiene check
  agent audit list --limit 20
  agent audit export --format jsonl --output .agent/tmp/audit-export.jsonl
  agent audit export --format bundle --output .agent/tmp/audit-export.bundle.json
  agent audit verify .agent/tmp/audit-export.bundle.json
  agent web --port 4317
  agent tool create_file '{"path":"tmp/example.txt","content":"hello"}'
`);
}

async function appendApprovalDecisionRoomMessage(
  store: Awaited<ReturnType<typeof createLocalPlatform>>["store"],
  approval: Awaited<ReturnType<Awaited<ReturnType<typeof createLocalPlatform>>["store"]["decideApproval"]>>,
  actor: ActorRef,
): Promise<void> {
  if (!approval?.roomId) {
    return;
  }
  await store.appendRoomMessage({
    id: makeId<"MessageId">("msg"),
    roomId: approval.roomId as Parameters<typeof store.appendRoomMessage>[0]["roomId"],
    sender: actor,
    kind: "approval",
    body: `Approval ${approval.status}: ${approval.id}\nAction: ${approval.action}\nTool: ${approval.toolName ?? "-"}\nReason: ${approval.decisionReason ?? approval.reason}`,
    createdAt: new Date().toISOString(),
    artifactRefs: [],
  });
}

async function ensureApprovalDecisionAllowed(input: {
  approval: ApprovalRequest;
  decidedBy: ActorRef;
  rooms: Awaited<ReturnType<typeof createLocalPlatform>>["rooms"];
  organizations: Awaited<ReturnType<typeof createLocalPlatform>>["organizations"];
}): Promise<void> {
  const hasScopedApproval = Boolean(input.approval.orgId || input.approval.projectId || input.approval.roomId || input.approval.sessionId);
  if (!hasScopedApproval) {
    return;
  }

  if (input.approval.roomId) {
    try {
      await input.rooms.assertCapability(input.approval.roomId, input.decidedBy, "tool.approve");
      return;
    } catch {
      // Organization/project grants can also authorize room-scoped approvals.
    }
  }

  if (await hasApprovalGrant(input.organizations, input.decidedBy, input.approval, "agent.super_approve")) {
    return;
  }
  if (input.approval.action === "spec.plan.approve" && (await hasApprovalGrant(input.organizations, input.decidedBy, input.approval, "spec.plan.approve"))) {
    return;
  }
  if (await hasApprovalGrant(input.organizations, input.decidedBy, input.approval, "tool.approve")) {
    return;
  }

  const expected = input.approval.action === "spec.plan.approve" ? "spec.plan.approve or tool.approve" : "tool.approve";
  throw new Error(`Actor ${input.decidedBy.type}:${input.decidedBy.id} lacks ${expected} for approval ${input.approval.id}.`);
}

async function hasApprovalGrant(
  organizations: Awaited<ReturnType<typeof createLocalPlatform>>["organizations"],
  actor: ActorRef,
  approval: ApprovalRequest,
  capability: string,
): Promise<boolean> {
  if (actor.type !== "user" && actor.type !== "agent" && actor.type !== "service_account") {
    return false;
  }
  const checks: Array<{ scopeType: CapabilityGrant["scopeType"]; scopeId?: string }> = [
    { scopeType: "session", scopeId: approval.sessionId },
    { scopeType: "room", scopeId: approval.roomId },
    { scopeType: "project", scopeId: approval.projectId },
    { scopeType: "organization", scopeId: approval.orgId },
  ];
  for (const check of checks) {
    if (!check.scopeId) {
      continue;
    }
    const ok = await organizations.hasCapability({
      subjectType: actor.type,
      subjectId: actor.id,
      scopeType: check.scopeType,
      scopeId: check.scopeId,
      capability,
    });
    if (ok) {
      return true;
    }
  }
  return false;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseRemoteArgs(args: string[]): { options: RemoteCliOptions; positionals: string[] } {
  const options: RemoteCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--control-url" && next) {
      options.controlUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--control-token" && next) {
      options.controlToken = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      options.roomId = next;
      index += 1;
      continue;
    }
    if (arg === "--invite-token" && next) {
      options.inviteToken = next;
      index += 1;
      continue;
    }
    if (arg === "--display-name" && next) {
      options.displayName = next;
      index += 1;
      continue;
    }
    if (arg === "--message-id" && next) {
      options.messageId = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--limit must be a positive integer.");
      }
      options.limit = parsed;
      index += 1;
      continue;
    }
    if (arg === "--cycles" && next) {
      options.maxCycles = parsePositiveInteger(next, "--cycles");
      index += 1;
      continue;
    }
    if (arg === "--idle-limit" && next) {
      options.maxIdlePolls = parseNonNegativeInteger(next, "--idle-limit");
      index += 1;
      continue;
    }
    if (arg === "--idle-cycles" && next) {
      options.maxIdleCycles = parseNonNegativeInteger(next, "--idle-cycles");
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      options.idleIntervalMs = parseNonNegativeInteger(next, "--interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--loop-interval-ms" && next) {
      options.loopIntervalMs = parseNonNegativeInteger(next, "--loop-interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--stop-when-idle") {
      options.stopWhenIdle = true;
      continue;
    }
    if (arg === "--backoff-ms" && next) {
      options.baseBackoffMs = parseNonNegativeInteger(next, "--backoff-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-backoff-ms" && next) {
      options.maxBackoffMs = parseNonNegativeInteger(next, "--max-backoff-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-errors" && next) {
      options.maxErrors = parsePositiveInteger(next, "--max-errors");
      index += 1;
      continue;
    }
    if (arg === "--heartbeat-ttl" && next) {
      options.heartbeatTtlSeconds = parseNonNegativeInteger(next, "--heartbeat-ttl");
      index += 1;
      continue;
    }
    if (arg === "--ttl" && next) {
      options.ttlSeconds = parseNonNegativeInteger(next, "--ttl");
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.heartbeatStatus = parseAgentHeartbeatStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--last-error" && next) {
      options.lastError = next;
      index += 1;
      continue;
    }
    if (arg === "--include-delivered") {
      options.includeDelivered = true;
      continue;
    }
    if (arg === "--alias" && next) {
      options.aliases = [...(options.aliases ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

async function controlPlaneJson<T>(controlUrl: string, path: string, token: string, body: Record<string, unknown>): Promise<T> {
  const url = new URL(path, controlUrl.endsWith("/") ? controlUrl : `${controlUrl}/`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-control-token": token,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(`Control plane ${response.status}: ${payload.error ?? response.statusText}`);
  }
  return payload as T;
}

function isTargetModeCommand(value: string): boolean {
  return value === "plan" || value === "lplan" || value === "build" || value === "builld" || value === "goal";
}

function parseTargetMode(value: string): NonNullable<Parameters<typeof createLocalPlatform>[1]>["targetMode"] {
  if (value === "plan" || value === "lplan") {
    return "plan";
  }
  if (value === "build" || value === "builld") {
    return "build";
  }
  if (value === "goal") {
    return "goal";
  }
  throw new Error(`Invalid target mode: ${value}. Expected plan, build, or goal.`);
}

function parseAgentHeartbeatStatus(value: string): AgentHeartbeatStatus {
  if (value === "online" || value === "idle" || value === "running" || value === "error" || value === "offline") {
    return value;
  }
  throw new Error(`Invalid agent heartbeat status: ${value}. Expected online, idle, running, error, or offline.`);
}

function parseRoomRole(value: string): RoomRole {
  if (
    value === "owner" ||
    value === "moderator" ||
    value === "participant" ||
    value === "observer" ||
    value === "executor" ||
    value === "reviewer" ||
    value === "approver"
  ) {
    return value;
  }
  throw new Error(`Invalid room role: ${value}.`);
}

function parseRoomMemberStatus(value: string): RoomMemberStatus {
  if (
    value === "invited" ||
    value === "pending" ||
    value === "active" ||
    value === "suspended" ||
    value === "left" ||
    value === "removed" ||
    value === "expired"
  ) {
    return value;
  }
  throw new Error(`Invalid room member status: ${value}.`);
}

function isWorkerHeartbeatEnvelope(value: unknown): value is WorkerHeartbeatEnvelope {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.workerId === "string" &&
    typeof value.agentId === "string" &&
    typeof value.machineId === "string" &&
    typeof value.status === "string" &&
    typeof value.currentLoad === "number" &&
    typeof value.maxConcurrentTasks === "number" &&
    typeof value.heartbeatAt === "string" &&
    isRecord(value.heartbeatBy) &&
    typeof value.heartbeatBy.type === "string" &&
    typeof value.heartbeatBy.id === "string" &&
    typeof value.nonce === "string"
  );
}

function parseKnowledgeSafetyMode(value: string): KnowledgeSafetyMode {
  if (value === "off" || value === "annotate" || value === "exclude") {
    return value;
  }
  throw new Error(`Invalid knowledge safety mode: ${value}. Expected off, annotate, or exclude.`);
}

type RoomCliOptions = {
  actor?: string;
  agentId?: string;
  role?: "owner" | "moderator" | "participant" | "observer" | "executor" | "reviewer" | "approver";
  status?: "invited" | "pending" | "active" | "suspended" | "left" | "removed" | "expired";
  kind?: "chat" | "task" | "decision" | "tool_request" | "approval" | "artifact" | "system";
  joinPolicy?: "manual" | "invite_token" | "fingerprint_allowlist" | "quorum" | "same_org";
  agentResponseMode?: "broadcast" | "mentions_only";
  wideMentionPolicy?: "disabled" | "moderators" | "members";
  maxRoutedAgentTargets?: number;
  requireSignedInvites?: boolean;
  aliases?: string[];
  allowedFingerprints?: string[];
  allowLocalAgent?: boolean;
  localAgent?: boolean;
  inviteToken?: string;
  projectId?: string;
  limit?: number;
  requiredApprovals?: number;
  maxMembers?: number;
  maxUses?: number;
  transcriptRetentionDays?: number;
  ttlHours?: number;
  messageId?: string;
  includeDelivered?: boolean;
  json?: boolean;
};

type RemoteCliOptions = {
  controlUrl?: string;
  controlToken?: string;
  roomId?: string;
  inviteToken?: string;
  displayName?: string;
  aliases?: string[];
  messageId?: string;
  limit?: number;
  maxCycles?: number;
  maxIdlePolls?: number;
  maxIdleCycles?: number;
  idleIntervalMs?: number;
  loopIntervalMs?: number;
  stopWhenIdle?: boolean;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxErrors?: number;
  heartbeatTtlSeconds?: number;
  ttlSeconds?: number;
  heartbeatStatus?: AgentHeartbeatStatus;
  lastError?: string;
  includeDelivered?: boolean;
  json?: boolean;
};

type WorkerCliOptions = {
  actor?: string;
  localAgent?: boolean;
  agentId?: string;
  machineId?: string;
  orgId?: string;
  projectId?: string;
  displayName?: string;
  endpoint?: string;
  status?: WorkerStatus;
  currentLoad?: number;
  maxConcurrentTasks?: number;
  ttlSeconds?: number;
  before?: string;
  now?: string;
  requireSignedLeaseEnvelope?: boolean;
  limit?: number;
  maxIdlePolls?: number;
  idleIntervalMs?: number;
  capabilities?: string[];
  allowedProjects?: string[];
  metadataJson?: string;
};

type AssignmentCliOptions = {
  actor?: string;
  workerId?: string;
  retryWorkerId?: string;
  autoSelectRetryWorker?: boolean;
  status?: TaskAssignmentStatus;
  sessionId?: string;
  subtaskId?: string;
  projectId?: string;
  roomId?: string;
  leaseTtlSeconds?: number;
  priority?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  before?: string;
  limit?: number;
  exhaustedTargetStatus?: "paused" | "failed";
  metadataJson?: string;
};

type SchedulerCliOptions = {
  actor?: string;
  workerId?: string;
  requireSignedWorkerHeartbeat?: boolean;
  requireSignedLeaseEnvelope?: boolean;
  leaseTtlSeconds?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  recoverLimit?: number;
  maxRunsPerWorker?: number;
  maxIdlePolls?: number;
  idleIntervalMs?: number;
  dispatchSpecId?: string;
  dispatchLimit?: number;
  dispatchWorkerId?: string;
  dispatchAutoSelectWorker?: boolean;
  dispatchPriority?: number;
  dispatchMaxLoadRatio?: number;
  dispatchMaxQueuedAssignmentsPerWorker?: number;
  completeDrainedWorkers?: boolean;
  warnLoadRatio?: number;
  warnQueueRatio?: number;
  intervalMs?: number;
  maxTicks?: number;
  stopWhenIdle?: boolean;
  idleTickLimit?: number;
};

type OrgCliOptions = {
  defaultRole?: "owner" | "admin" | "member" | "viewer" | "service";
  retentionPolicyId?: string;
  expiresAt?: string;
  subject?: string;
  scopeType?: CapabilityGrant["scopeType"];
  scopeId?: string;
};

function parseOrgArgs(args: string[]): { options: OrgCliOptions; positionals: string[] } {
  const options: OrgCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--default-role" && next) {
      options.defaultRole = next as OrgCliOptions["defaultRole"];
      index += 1;
      continue;
    }
    if (arg === "--retention-policy" && next) {
      options.retentionPolicyId = next;
      index += 1;
      continue;
    }
    if (arg === "--expires-at" && next) {
      options.expiresAt = next;
      index += 1;
      continue;
    }
    if (arg === "--subject" && next) {
      options.subject = next;
      index += 1;
      continue;
    }
    if (arg === "--scope-type" && next) {
      options.scopeType = next as CapabilityGrant["scopeType"];
      index += 1;
      continue;
    }
    if (arg === "--scope-id" && next) {
      options.scopeId = next;
      index += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

function parseAssignmentArgs(args: string[]): { options: AssignmentCliOptions; positionals: string[] } {
  const options: AssignmentCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor" && next) {
      options.actor = next;
      index += 1;
      continue;
    }
    if (arg === "--worker" && next) {
      options.workerId = next;
      index += 1;
      continue;
    }
    if (arg === "--retry-worker" && next) {
      options.retryWorkerId = next;
      index += 1;
      continue;
    }
    if (arg === "--auto-select-worker") {
      options.autoSelectRetryWorker = true;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseAssignmentStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--session" && next) {
      options.sessionId = next;
      index += 1;
      continue;
    }
    if (arg === "--subtask" && next) {
      options.subtaskId = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      options.roomId = next;
      index += 1;
      continue;
    }
    if (arg === "--ttl" && next) {
      options.leaseTtlSeconds = parseNonNegativeInteger(next, "--ttl");
      index += 1;
      continue;
    }
    if (arg === "--priority" && next) {
      options.priority = parseNonNegativeInteger(next, "--priority");
      index += 1;
      continue;
    }
    if (arg === "--max-attempts" && next) {
      options.maxAttempts = parseNonNegativeInteger(next, "--max-attempts");
      index += 1;
      continue;
    }
    if (arg === "--backoff-ms" && next) {
      options.baseBackoffMs = parseNonNegativeInteger(next, "--backoff-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-backoff-ms" && next) {
      options.maxBackoffMs = parseNonNegativeInteger(next, "--max-backoff-ms");
      index += 1;
      continue;
    }
    if (arg === "--jitter-ms" && next) {
      options.jitterMs = parseNonNegativeInteger(next, "--jitter-ms");
      index += 1;
      continue;
    }
    if (arg === "--before" && next) {
      options.before = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = parseNonNegativeInteger(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--exhausted-status" && next) {
      if (next !== "paused" && next !== "failed") {
        throw new Error("--exhausted-status must be paused or failed.");
      }
      options.exhaustedTargetStatus = next;
      index += 1;
      continue;
    }
    if (arg === "--metadata-json" && next) {
      options.metadataJson = next;
      index += 1;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function parseAssignmentStatus(value: string): TaskAssignmentStatus {
  if (value === "leased" || value === "running" || value === "paused" || value === "completed" || value === "failed" || value === "cancelled" || value === "expired") {
    return value;
  }
  throw new Error(`Invalid assignment status: ${value}`);
}

function parseSpecificationVerificationStatus(value: string): SpecificationVerificationStatus {
  if (value === "passed" || value === "failed") {
    return value;
  }
  throw new Error(`Invalid specification verification status: ${value}`);
}

function parseSpecificationEvidenceProvider(value: string): SpecificationEvidenceProvider {
  if (value === "github" || value === "gitlab" || value === "generic") {
    return value;
  }
  throw new Error(`Invalid specification evidence provider: ${value}`);
}

function parseSpecificationEvidenceConclusion(value: string): SpecificationEvidenceConclusion {
  if (value === "success" || value === "failure" || value === "cancelled" || value === "skipped" || value === "neutral" || value === "timed_out" || value === "action_required") {
    return value;
  }
  throw new Error(`Invalid specification evidence conclusion: ${value}`);
}

function parseAnswerClarificationStatus(value: string): "answered" | "resolved" {
  const status = parseSpecificationClarificationStatus(value);
  if (status === "answered" || status === "resolved") {
    return status;
  }
  throw new Error("Clarification answer status must be answered or resolved.");
}

function parseSpecificationPlanStatus(value: string, allowed: SpecificationPlanStatus[] = ["draft", "active", "superseded", "archived"]): SpecificationPlanStatus {
  if ((["draft", "active", "superseded", "archived"] as string[]).includes(value) && (allowed as string[]).includes(value)) {
    return value as SpecificationPlanStatus;
  }
  throw new Error(`Invalid specification plan status: ${value}`);
}

function parseSchedulerArgs(args: string[]): { options: SchedulerCliOptions; positionals: string[] } {
  const options: SchedulerCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor" && next) {
      options.actor = next;
      index += 1;
      continue;
    }
    if (arg === "--worker" && next) {
      options.workerId = next;
      index += 1;
      continue;
    }
    if (arg === "--require-signed-heartbeat") {
      options.requireSignedWorkerHeartbeat = true;
      continue;
    }
    if (arg === "--require-signed-lease") {
      options.requireSignedLeaseEnvelope = true;
      continue;
    }
    if (arg === "--ttl" && next) {
      options.leaseTtlSeconds = parseNonNegativeInteger(next, "--ttl");
      index += 1;
      continue;
    }
    if (arg === "--max-attempts" && next) {
      options.maxAttempts = parseNonNegativeInteger(next, "--max-attempts");
      index += 1;
      continue;
    }
    if (arg === "--backoff-ms" && next) {
      options.baseBackoffMs = parseNonNegativeInteger(next, "--backoff-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-backoff-ms" && next) {
      options.maxBackoffMs = parseNonNegativeInteger(next, "--max-backoff-ms");
      index += 1;
      continue;
    }
    if (arg === "--jitter-ms" && next) {
      options.jitterMs = parseNonNegativeInteger(next, "--jitter-ms");
      index += 1;
      continue;
    }
    if (arg === "--recover-limit" && next) {
      options.recoverLimit = parseNonNegativeInteger(next, "--recover-limit");
      index += 1;
      continue;
    }
    if (arg === "--dispatch-spec" && next) {
      options.dispatchSpecId = next;
      index += 1;
      continue;
    }
    if (arg === "--dispatch-limit" && next) {
      options.dispatchLimit = parseNonNegativeInteger(next, "--dispatch-limit");
      index += 1;
      continue;
    }
    if (arg === "--dispatch-worker" && next) {
      options.dispatchWorkerId = next;
      index += 1;
      continue;
    }
    if (arg === "--dispatch-auto-select-worker") {
      options.dispatchAutoSelectWorker = true;
      continue;
    }
    if (arg === "--dispatch-priority" && next) {
      options.dispatchPriority = parseNonNegativeInteger(next, "--dispatch-priority");
      index += 1;
      continue;
    }
    if (arg === "--dispatch-max-load-ratio" && next) {
      options.dispatchMaxLoadRatio = parseRatio(next, "--dispatch-max-load-ratio");
      index += 1;
      continue;
    }
    if (arg === "--dispatch-max-queued-per-worker" && next) {
      options.dispatchMaxQueuedAssignmentsPerWorker = parseNonNegativeInteger(next, "--dispatch-max-queued-per-worker");
      index += 1;
      continue;
    }
    if (arg === "--complete-drained-workers") {
      options.completeDrainedWorkers = true;
      continue;
    }
    if (arg === "--warn-load-ratio" && next) {
      options.warnLoadRatio = parseRatio(next, "--warn-load-ratio");
      index += 1;
      continue;
    }
    if (arg === "--warn-queue-ratio" && next) {
      options.warnQueueRatio = parseNonNegativeNumber(next, "--warn-queue-ratio");
      index += 1;
      continue;
    }
    if (arg === "--runs-per-worker" && next) {
      options.maxRunsPerWorker = parseNonNegativeInteger(next, "--runs-per-worker");
      index += 1;
      continue;
    }
    if (arg === "--idle-limit" && next) {
      options.maxIdlePolls = parseNonNegativeInteger(next, "--idle-limit");
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-ms" && next) {
      options.idleIntervalMs = parseNonNegativeInteger(next, "--poll-interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      options.intervalMs = parseNonNegativeInteger(next, "--interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-ticks" && next) {
      options.maxTicks = parseNonNegativeInteger(next, "--max-ticks");
      index += 1;
      continue;
    }
    if (arg === "--idle-ticks" && next) {
      options.idleTickLimit = parseNonNegativeInteger(next, "--idle-ticks");
      index += 1;
      continue;
    }
    if (arg === "--stop-when-idle") {
      options.stopWhenIdle = true;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function parseWorkerArgs(args: string[]): { options: WorkerCliOptions; positionals: string[] } {
  const options: WorkerCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor" && next) {
      options.actor = next;
      index += 1;
      continue;
    }
    if (arg === "--local-agent") {
      options.localAgent = true;
      continue;
    }
    if (arg === "--agent" && next) {
      options.agentId = next;
      index += 1;
      continue;
    }
    if (arg === "--machine" && next) {
      options.machineId = next;
      index += 1;
      continue;
    }
    if (arg === "--org" && next) {
      options.orgId = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      options.allowedProjects = [...(options.allowedProjects ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--display-name" && next) {
      options.displayName = next;
      index += 1;
      continue;
    }
    if (arg === "--endpoint" && next) {
      options.endpoint = next;
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseWorkerStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--load" && next) {
      options.currentLoad = parseNonNegativeInteger(next, "--load");
      index += 1;
      continue;
    }
    if (arg === "--max-tasks" && next) {
      options.maxConcurrentTasks = parseNonNegativeInteger(next, "--max-tasks");
      index += 1;
      continue;
    }
    if (arg === "--ttl" && next) {
      options.ttlSeconds = parseNonNegativeInteger(next, "--ttl");
      index += 1;
      continue;
    }
    if (arg === "--require-signed-lease") {
      options.requireSignedLeaseEnvelope = true;
      continue;
    }
    if (arg === "--before" && next) {
      options.before = next;
      index += 1;
      continue;
    }
    if (arg === "--now" && next) {
      options.now = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = parseNonNegativeInteger(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--idle-limit" && next) {
      options.maxIdlePolls = parseNonNegativeInteger(next, "--idle-limit");
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      options.idleIntervalMs = parseNonNegativeInteger(next, "--interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--cap" && next) {
      options.capabilities = [...(options.capabilities ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--metadata-json" && next) {
      options.metadataJson = next;
      index += 1;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function parseWorkerStatus(value: string): WorkerStatus {
  if (value === "online" || value === "offline" || value === "draining" || value === "suspended") {
    return value;
  }
  throw new Error(`Invalid worker status: ${value}`);
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseRatio(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1.`);
  }
  return parsed;
}

type RetentionCliOptions = {
  hotTranscriptDays?: number;
  artifactRetentionDays?: number;
  auditRetentionDays?: number;
  enableAutoSummaries?: boolean;
  allowUserDeletion?: boolean;
  allowAuditExport?: boolean;
};

function parseRetentionArgs(args: string[]): { options: RetentionCliOptions; positionals: string[] } {
  const options: RetentionCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--hot-days" && next) {
      options.hotTranscriptDays = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--artifact-days" && next) {
      options.artifactRetentionDays = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--audit-days" && next) {
      options.auditRetentionDays = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--no-auto-summaries") {
      options.enableAutoSummaries = false;
      continue;
    }
    if (arg === "--no-user-delete") {
      options.allowUserDeletion = false;
      continue;
    }
    if (arg === "--no-audit-export") {
      options.allowAuditExport = false;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

type ArtifactCliOptions = {
  kind?: ArtifactKind;
  name?: string;
  uri?: string;
  mimeType?: string;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  sessionId?: string;
  status?: "active" | "deleted";
  limit?: number;
  deleteFile?: boolean;
  force?: boolean;
};

type SpecCliOptions = {
  title?: string;
  orgId?: string;
  projectId?: string;
  roomId?: string;
  status?: string;
  limit?: number;
  description?: string;
  parallelizable?: boolean;
  paths?: string[];
  dependsOn?: string[];
  verification?: string;
  order?: number;
  assignedAgentId?: string;
  executionMode?: ExecutionMode;
  risk?: TaskRisk;
  workerId?: string;
  autoSelectWorker?: boolean;
  maxDispatchLoadRatio?: number;
  maxQueuedAssignmentsPerWorker?: number;
  ttlSeconds?: number;
  priority?: number;
  evidence?: string;
  verificationStatus?: string;
  provider?: string;
  conclusion?: string;
  checkName?: string;
  runId?: string;
  url?: string;
  sha?: string;
  branch?: string;
  externalId?: string;
  reason?: string;
  summary?: string;
  versionId?: string;
  planId?: string;
  fromVersion?: string;
  toVersion?: string;
  requirePlanApproval?: boolean;
  requiredPlanApprovals?: number;
  resolve?: boolean;
  saveArtifact?: boolean;
  artifactName?: string;
  artifactRefs?: string[];
  json?: boolean;
};

function parseSpecArgs(args: string[]): { options: SpecCliOptions; positionals: string[] } {
  const options: SpecCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--title" && next) {
      options.title = next;
      index += 1;
      continue;
    }
    if (arg === "--org" && next) {
      options.orgId = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      options.roomId = next;
      index += 1;
      continue;
    }
    if (arg === "--assigned-agent" && next) {
      options.assignedAgentId = next;
      index += 1;
      continue;
    }
    if (arg === "--worker" && next) {
      options.workerId = next;
      index += 1;
      continue;
    }
    if (arg === "--auto-select-worker") {
      options.autoSelectWorker = true;
      continue;
    }
    if (arg === "--max-load-ratio" && next) {
      options.maxDispatchLoadRatio = parseRatio(next, "--max-load-ratio");
      index += 1;
      continue;
    }
    if (arg === "--max-queued-per-worker" && next) {
      options.maxQueuedAssignmentsPerWorker = parseNonNegativeInteger(next, "--max-queued-per-worker");
      index += 1;
      continue;
    }
    if (arg === "--ttl" && next) {
      options.ttlSeconds = parseNonNegativeInteger(next, "--ttl");
      index += 1;
      continue;
    }
    if (arg === "--priority" && next) {
      options.priority = parseNonNegativeInteger(next, "--priority");
      index += 1;
      continue;
    }
    if (arg === "--execution-mode" && next) {
      options.executionMode = next as ExecutionMode;
      index += 1;
      continue;
    }
    if (arg === "--risk" && next) {
      options.risk = next as TaskRisk;
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = next;
      index += 1;
      continue;
    }
    if (arg === "--reason" && next) {
      options.reason = next;
      index += 1;
      continue;
    }
    if (arg === "--summary" && next) {
      options.summary = next;
      index += 1;
      continue;
    }
    if (arg === "--version" && next) {
      options.versionId = next;
      index += 1;
      continue;
    }
    if (arg === "--from" && next) {
      options.fromVersion = next;
      index += 1;
      continue;
    }
    if (arg === "--to" && next) {
      options.toVersion = next;
      index += 1;
      continue;
    }
    if (arg === "--plan" && next) {
      options.planId = next;
      index += 1;
      continue;
    }
    if (arg === "--require-plan-approval") {
      options.requirePlanApproval = true;
      continue;
    }
    if (arg === "--required-plan-approvals" && next) {
      options.requiredPlanApprovals = parsePositiveInteger(next, "--required-plan-approvals");
      index += 1;
      continue;
    }
    if (arg === "--resolve") {
      options.resolve = true;
      continue;
    }
    if (arg === "--save-artifact") {
      options.saveArtifact = true;
      continue;
    }
    if (arg === "--artifact-name" && next) {
      options.artifactName = next;
      index += 1;
      continue;
    }
    if (arg === "--verification-status" && next) {
      options.verificationStatus = next;
      index += 1;
      continue;
    }
    if (arg === "--provider" && next) {
      options.provider = next;
      index += 1;
      continue;
    }
    if (arg === "--conclusion" && next) {
      options.conclusion = next;
      index += 1;
      continue;
    }
    if (arg === "--check" && next) {
      options.checkName = next;
      index += 1;
      continue;
    }
    if (arg === "--run-id" && next) {
      options.runId = next;
      index += 1;
      continue;
    }
    if (arg === "--url" && next) {
      options.url = next;
      index += 1;
      continue;
    }
    if (arg === "--sha" && next) {
      options.sha = next;
      index += 1;
      continue;
    }
    if (arg === "--branch" && next) {
      options.branch = next;
      index += 1;
      continue;
    }
    if (arg === "--external-id" && next) {
      options.externalId = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = parseNonNegativeInteger(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--description" && next) {
      options.description = next;
      index += 1;
      continue;
    }
    if (arg === "--parallel") {
      options.parallelizable = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--path" && next) {
      options.paths = [...(options.paths ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--depends-on" && next) {
      options.dependsOn = [...(options.dependsOn ?? []), next];
      index += 1;
      continue;
    }
    if ((arg === "--verify" || arg === "--verification") && next) {
      options.verification = next;
      index += 1;
      continue;
    }
    if (arg === "--evidence" && next) {
      options.evidence = next;
      index += 1;
      continue;
    }
    if (arg === "--artifact" && next) {
      options.artifactRefs = [...(options.artifactRefs ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--order" && next) {
      options.order = parseNonNegativeInteger(next, "--order");
      index += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

type KnowledgeCliOptions = {
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  kind?: KnowledgeSourceKind;
  name?: string;
  uri?: string;
  description?: string;
  trustLevel?: KnowledgeTrustLevel;
  inputFile?: string;
  limit?: number;
  evalSetId?: string;
  regressionTolerance?: number;
  minRecallAtK?: number;
  minMrr?: number;
  maxEmptyResultRate?: number;
  minCitationPrecision?: number;
  maxPermissionLeakRate?: number;
  saveArtifact?: boolean;
  saveRun?: boolean;
  artifactName?: string;
  enforceAccess?: boolean;
  safetyMode?: KnowledgeSafetyMode;
  json?: boolean;
};

function parseKnowledgeArgs(args: string[]): { options: KnowledgeCliOptions; positionals: string[] } {
  const options: KnowledgeCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === "--scope-type" || arg === "--knowledge-scope") && next) {
      options.scopeType = next as MemoryScope;
      index += 1;
      continue;
    }
    if ((arg === "--scope-id" || arg === "--knowledge-id") && next) {
      options.scopeId = next;
      index += 1;
      continue;
    }
    if (arg === "--source" && next) {
      options.sourceId = next;
      index += 1;
      continue;
    }
    if (arg === "--kind" && next) {
      options.kind = next as KnowledgeSourceKind;
      index += 1;
      continue;
    }
    if (arg === "--name" && next) {
      options.name = next;
      index += 1;
      continue;
    }
    if (arg === "--uri" && next) {
      options.uri = next;
      index += 1;
      continue;
    }
    if (arg === "--description" && next) {
      options.description = next;
      index += 1;
      continue;
    }
    if (arg === "--trust" && next) {
      options.trustLevel = next as KnowledgeTrustLevel;
      index += 1;
      continue;
    }
    if ((arg === "--file" || arg === "--input-file") && next) {
      options.inputFile = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--eval-set" && next) {
      options.evalSetId = next;
      index += 1;
      continue;
    }
    if (arg === "--regression-tolerance" && next) {
      options.regressionTolerance = parseRatio(next, "--regression-tolerance");
      index += 1;
      continue;
    }
    if (arg === "--min-recall" && next) {
      options.minRecallAtK = parseRatio(next, "--min-recall");
      index += 1;
      continue;
    }
    if (arg === "--min-mrr" && next) {
      options.minMrr = parseRatio(next, "--min-mrr");
      index += 1;
      continue;
    }
    if (arg === "--max-empty-rate" && next) {
      options.maxEmptyResultRate = parseRatio(next, "--max-empty-rate");
      index += 1;
      continue;
    }
    if (arg === "--min-citation-precision" && next) {
      options.minCitationPrecision = parseRatio(next, "--min-citation-precision");
      index += 1;
      continue;
    }
    if (arg === "--max-permission-leak-rate" && next) {
      options.maxPermissionLeakRate = parseRatio(next, "--max-permission-leak-rate");
      index += 1;
      continue;
    }
    if (arg === "--save-artifact") {
      options.saveArtifact = true;
      continue;
    }
    if (arg === "--save-run") {
      options.saveRun = true;
      continue;
    }
    if (arg === "--artifact-name" && next) {
      options.artifactName = next;
      index += 1;
      continue;
    }
    if (arg === "--enforce-acl" || arg === "--enforce-access") {
      options.enforceAccess = true;
      continue;
    }
    if (arg === "--safety" && next) {
      options.safetyMode = parseKnowledgeSafetyMode(next);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

type KnowledgeEvalFile = {
  cases: KnowledgeEvalCase[];
  scopeType?: MemoryScope;
  scopeId?: string;
  sourceId?: string;
  limit?: number;
  thresholds?: KnowledgeEvalThresholds;
  enforceAccess?: boolean;
  safetyMode?: KnowledgeSafetyMode;
};

function parseKnowledgeEvalFile(value: string): KnowledgeEvalFile {
  if (!value.trim()) {
    return { cases: [] };
  }
  const parsed = JSON.parse(value) as unknown;
  const root = Array.isArray(parsed) ? { cases: parsed } : parsed;
  if (!isRecord(root)) {
    throw new Error("Knowledge eval file must be a JSON object or array.");
  }
  const rawCases = root.cases;
  if (!Array.isArray(rawCases)) {
    throw new Error("Knowledge eval file must include a cases array.");
  }
  const cases = rawCases.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Knowledge eval case ${index + 1} must be an object.`);
    }
    const query = stringField(item, "query");
    if (!query) {
      throw new Error(`Knowledge eval case ${index + 1} must include query.`);
    }
    const expectedSourceIds = stringArrayField(item, "expectedSourceIds");
    const expectedChunkIds = stringArrayField(item, "expectedChunkIds");
    const forbiddenSourceIds = stringArrayField(item, "forbiddenSourceIds");
    const forbiddenChunkIds = stringArrayField(item, "forbiddenChunkIds");
    if (expectedSourceIds.length === 0 && expectedChunkIds.length === 0 && forbiddenSourceIds.length === 0 && forbiddenChunkIds.length === 0) {
      throw new Error(`Knowledge eval case ${index + 1} must include expectedSourceIds, expectedChunkIds, forbiddenSourceIds, or forbiddenChunkIds.`);
    }
    return {
      id: stringField(item, "id"),
      query,
      scopeType: stringField(item, "scopeType") as MemoryScope | undefined,
      scopeId: stringField(item, "scopeId"),
      sourceId: stringField(item, "sourceId"),
      expectedSourceIds,
      expectedChunkIds,
      forbiddenSourceIds,
      forbiddenChunkIds,
    };
  });
  return {
    cases,
    scopeType: stringField(root, "scopeType") as MemoryScope | undefined,
    scopeId: stringField(root, "scopeId"),
    sourceId: stringField(root, "sourceId"),
    limit: typeof root.limit === "number" ? root.limit : undefined,
    thresholds: isRecord(root.thresholds) ? knowledgeThresholdOptions({
      minRecallAtK: numberField(root.thresholds, "minRecallAtK"),
      minMrr: numberField(root.thresholds, "minMrr"),
      maxEmptyResultRate: numberField(root.thresholds, "maxEmptyResultRate"),
      minCitationPrecision: numberField(root.thresholds, "minCitationPrecision"),
      maxPermissionLeakRate: numberField(root.thresholds, "maxPermissionLeakRate"),
    }) : undefined,
    enforceAccess: booleanField(root, "enforceAccess"),
    safetyMode: stringField(root, "safetyMode") ? parseKnowledgeSafetyMode(stringField(root, "safetyMode") ?? "") : undefined,
  };
}

function knowledgeThresholdOptions(options: Pick<KnowledgeCliOptions, "minRecallAtK" | "minMrr" | "maxEmptyResultRate" | "minCitationPrecision" | "maxPermissionLeakRate">): KnowledgeEvalThresholds {
  const thresholds: KnowledgeEvalThresholds = {};
  if (options.minRecallAtK !== undefined) {
    thresholds.minRecallAtK = options.minRecallAtK;
  }
  if (options.minMrr !== undefined) {
    thresholds.minMrr = options.minMrr;
  }
  if (options.maxEmptyResultRate !== undefined) {
    thresholds.maxEmptyResultRate = options.maxEmptyResultRate;
  }
  if (options.minCitationPrecision !== undefined) {
    thresholds.minCitationPrecision = options.minCitationPrecision;
  }
  if (options.maxPermissionLeakRate !== undefined) {
    thresholds.maxPermissionLeakRate = options.maxPermissionLeakRate;
  }
  return thresholds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (field === undefined) {
    return [];
  }
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return field.map((item) => item.trim()).filter(Boolean);
}

function parseArtifactArgs(args: string[]): { options: ArtifactCliOptions; positionals: string[] } {
  const options: ArtifactCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--kind" && next) {
      options.kind = next as ArtifactKind;
      index += 1;
      continue;
    }
    if (arg === "--name" && next) {
      options.name = next;
      index += 1;
      continue;
    }
    if (arg === "--uri" && next) {
      options.uri = next;
      index += 1;
      continue;
    }
    if (arg === "--mime-type" && next) {
      options.mimeType = next;
      index += 1;
      continue;
    }
    if (arg === "--org" && next) {
      options.orgId = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      options.roomId = next;
      index += 1;
      continue;
    }
    if (arg === "--session" && next) {
      options.sessionId = next;
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = next as ArtifactCliOptions["status"];
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--delete-file") {
      options.deleteFile = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

type LifecycleCliOptions = {
  summary?: string;
  force?: boolean;
  json?: boolean;
  output?: string;
  limit?: number;
  requireChange?: boolean;
  requirePatch?: boolean;
  requireRecovery?: boolean;
  requireTimeout?: boolean;
  requireDiffStat?: boolean;
  requiredExecutionProfiles?: CommandExecutionProfileName[];
  requiredApprovalActions?: PolicyAction[];
  allowNoCommand?: boolean;
};

function parseSessionListArgs(args: string[]): { options: SessionListOptions; positionals: string[] } {
  const options: SessionListOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = parsePositiveInteger(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseSessionStatus(next);
      index += 1;
      continue;
    }
    if ((arg === "--target-mode" || arg === "--mode") && next) {
      options.targetMode = parseSessionTargetMode(next);
      index += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

function parseSessionStatus(value: string): NonNullable<SessionListOptions["status"]> {
  if (value === "created" || value === "running" || value === "paused" || value === "cancelled" || value === "failed" || value === "completed") {
    return value;
  }
  throw new Error(`Invalid session status: ${value}.`);
}

function parseSessionTargetMode(value: string): NonNullable<SessionListOptions["targetMode"]> {
  if (value === "plan" || value === "build" || value === "goal") {
    return value;
  }
  throw new Error(`Invalid session target mode: ${value}.`);
}

function parseLifecycleArgs(args: string[]): { options: LifecycleCliOptions; positionals: string[] } {
  const options: LifecycleCliOptions = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--summary" && next) {
      options.summary = next;
      index += 1;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = parsePositiveInteger(next, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--require-change") {
      options.requireChange = true;
      continue;
    }
    if (arg === "--require-patch") {
      options.requirePatch = true;
      continue;
    }
    if (arg === "--require-recovery") {
      options.requireRecovery = true;
      continue;
    }
    if (arg === "--require-timeout") {
      options.requireTimeout = true;
      continue;
    }
    if (arg === "--require-diff-stat" || arg === "--require-diff-stats") {
      options.requireDiffStat = true;
      continue;
    }
    const executionProfilesValue = inlineOptionValue(arg, "--require-execution-profiles") ?? inlineOptionValue(arg, "--require-execution-profile");
    if (executionProfilesValue !== undefined) {
      options.requiredExecutionProfiles = [...(options.requiredExecutionProfiles ?? []), ...parseCommandExecutionProfileList(executionProfilesValue)];
      continue;
    }
    if ((arg === "--require-execution-profile" || arg === "--require-execution-profiles") && next) {
      options.requiredExecutionProfiles = [...(options.requiredExecutionProfiles ?? []), ...parseCommandExecutionProfileList(next)];
      index += 1;
      continue;
    }
    const approvalActionsValue = inlineOptionValue(arg, "--require-approval-actions") ?? inlineOptionValue(arg, "--require-approval-action");
    if (approvalActionsValue !== undefined) {
      options.requiredApprovalActions = [...(options.requiredApprovalActions ?? []), ...parsePolicyActionList(approvalActionsValue)];
      continue;
    }
    if ((arg === "--require-approval-action" || arg === "--require-approval-actions") && next) {
      options.requiredApprovalActions = [...(options.requiredApprovalActions ?? []), ...parsePolicyActionList(next)];
      index += 1;
      continue;
    }
    if (arg === "--allow-no-command") {
      options.allowNoCommand = true;
      continue;
    }
    positionals.push(arg);
  }
  return { options, positionals };
}

function parseRoomArgs(args: string[]): { options: RoomCliOptions; positionals: string[] } {
  const options: RoomCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor" && next) {
      options.actor = next;
      index += 1;
      continue;
    }
    if ((arg === "--agent-id" || arg === "--agent") && next) {
      options.agentId = next;
      index += 1;
      continue;
    }
    if (arg === "--role" && next) {
      options.role = parseRoomRole(next);
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseRoomMemberStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--kind" && next) {
      options.kind = next as RoomCliOptions["kind"];
      index += 1;
      continue;
    }
    if (arg === "--join-policy" && next) {
      options.joinPolicy = next as RoomCliOptions["joinPolicy"];
      index += 1;
      continue;
    }
    if (arg === "--agent-response" && next) {
      if (next !== "broadcast" && next !== "mentions_only") {
        throw new Error("--agent-response must be broadcast or mentions_only.");
      }
      options.agentResponseMode = next;
      index += 1;
      continue;
    }
    if (arg === "--wide-mention-policy" && next) {
      if (next !== "disabled" && next !== "moderators" && next !== "members") {
        throw new Error("--wide-mention-policy must be disabled, moderators, or members.");
      }
      options.wideMentionPolicy = next;
      index += 1;
      continue;
    }
    if (arg === "--max-routed-agent-targets" && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--max-routed-agent-targets must be a non-negative integer.");
      }
      options.maxRoutedAgentTargets = parsed;
      index += 1;
      continue;
    }
    if (arg === "--require-signed-invites") {
      options.requireSignedInvites = true;
      continue;
    }
    if (arg === "--alias" && next) {
      options.aliases = [...(options.aliases ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--allow-fingerprint" && next) {
      options.allowedFingerprints = [...(options.allowedFingerprints ?? []), next];
      index += 1;
      continue;
    }
    if (arg === "--allow-local-agent") {
      options.allowLocalAgent = true;
      continue;
    }
    if (arg === "--local-agent") {
      options.localAgent = true;
      continue;
    }
    if (arg === "--invite-token" && next) {
      options.inviteToken = next;
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--required-approvals" && next) {
      options.requiredApprovals = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--max-members" && next) {
      options.maxMembers = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--max-uses" && next) {
      options.maxUses = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--retention-days" && next) {
      options.transcriptRetentionDays = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--ttl-hours" && next) {
      options.ttlHours = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--message-id" && next) {
      options.messageId = next;
      index += 1;
      continue;
    }
    if (arg === "--include-delivered") {
      options.includeDelivered = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

type ApprovalCliOptions = {
  actor?: string;
  localAgent?: boolean;
  autoReplay?: boolean;
  autoResume?: boolean;
  queueResumeWorkerId?: string;
};

type SecretCliOptions = {
  class?: PutSecretInput["class"];
  scopeType?: PutSecretInput["scopeType"];
  scopeId?: string;
  valueEnv?: string;
  valueFile?: string;
  purpose?: string;
  executionMode?: ExecutionMode;
  reveal?: boolean;
};

type AuditCliOptions = {
  format: "jsonl" | "json" | "bundle";
  output?: string;
};

type PrCliOptions = {
  input: {
    title: string;
    body?: string;
    branch?: string;
    base?: string;
    remote?: string;
    provider?: "github" | "gitlab";
    commitMessage?: string;
    commit?: boolean;
    push?: boolean;
    dryRun?: boolean;
  };
  executionMode: ExecutionMode;
};

async function parsePrArgs(args: string[]): Promise<PrCliOptions> {
  const input: PrCliOptions["input"] = {
    title: "",
    dryRun: true,
  };
  let bodyFile: string | undefined;
  let executionMode: ExecutionMode = "trusted";
  const titleParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--title" && next) {
      input.title = next;
      index += 1;
      continue;
    }
    if (arg === "--body" && next) {
      input.body = next;
      index += 1;
      continue;
    }
    if (arg === "--body-file" && next) {
      bodyFile = next;
      index += 1;
      continue;
    }
    if (arg === "--branch" && next) {
      input.branch = next;
      index += 1;
      continue;
    }
    if (arg === "--base" && next) {
      input.base = next;
      index += 1;
      continue;
    }
    if (arg === "--remote" && next) {
      input.remote = next;
      index += 1;
      continue;
    }
    if (arg === "--provider" && next) {
      if (next !== "github" && next !== "gitlab") {
        throw new Error("--provider must be github or gitlab.");
      }
      input.provider = next;
      index += 1;
      continue;
    }
    if (arg === "--commit") {
      input.commit = true;
      continue;
    }
    if (arg === "--commit-message" && next) {
      input.commitMessage = next;
      index += 1;
      continue;
    }
    if (arg === "--push") {
      input.push = true;
      continue;
    }
    if (arg === "--apply" || arg === "--no-dry-run") {
      input.dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      input.dryRun = true;
      continue;
    }
    if (arg === "--execution-mode" && next) {
      executionMode = next as ExecutionMode;
      index += 1;
      continue;
    }
    titleParts.push(arg);
  }

  if (!input.title) {
    input.title = titleParts.join(" ").trim();
  }
  if (!input.title) {
    throw new Error("Usage: agent pr prepare --title title [--body text|--body-file file] [--branch branch] [--base main]");
  }
  if (bodyFile) {
    const { promises: fs } = await import("node:fs");
    input.body = await fs.readFile(bodyFile, "utf8");
  }
  return { input, executionMode };
}

async function ensureGitPolicyAllowed(input: {
  action: PolicyAction;
  mode: ExecutionMode;
  actor: ActorRef;
  policy: Awaited<ReturnType<typeof createLocalPlatform>>["policy"];
  store: Awaited<ReturnType<typeof createLocalPlatform>>["store"];
  summary: string;
}): Promise<void> {
  const decision = await input.policy.evaluate({
    actor: input.actor,
    action: input.action,
    mode: input.mode,
    risk: "medium",
    scope: {},
    metadata: {
      summary: input.summary,
    },
    requestedAt: new Date().toISOString(),
  });
  if (decision.type === "allow") {
    return;
  }
  if (decision.type === "deny") {
    await input.store.recordAuditEvent({
      id: makeId<"ArtifactId">("audit"),
      type: "policy.denied",
      actor: input.actor,
      summary: `${input.action} denied: ${decision.reason}`,
      metadata: { action: input.action, decision, operation: input.summary },
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    });
    throw new Error(decision.reason);
  }
  const approvalId = makeId<"ArtifactId">("appr");
  await input.store.createApprovalRequest({
    id: approvalId,
    status: "pending",
    requestedBy: input.actor,
    action: input.action,
    reason: decision.reason,
    approverHint: decision.approverHint,
    inputSummary: input.summary,
    createdAt: new Date().toISOString(),
  });
  throw new Error(`${decision.reason} Approval request: ${approvalId}.`);
}

function parseAuditArgs(args: string[]): { filters: ListAuditEventsInput; options: AuditCliOptions } {
  const filters: ListAuditEventsInput = { limit: 100 };
  const options: AuditCliOptions = { format: "jsonl" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--limit" && next) {
      filters.limit = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--type" && next) {
      filters.type = next as ListAuditEventsInput["type"];
      index += 1;
      continue;
    }
    if (arg === "--actor" && next) {
      filters.actorId = next;
      index += 1;
      continue;
    }
    if (arg === "--session" && next) {
      filters.sessionId = next as ListAuditEventsInput["sessionId"];
      index += 1;
      continue;
    }
    if (arg === "--room" && next) {
      filters.roomId = next as ListAuditEventsInput["roomId"];
      index += 1;
      continue;
    }
    if (arg === "--project" && next) {
      filters.projectId = next as ListAuditEventsInput["projectId"];
      index += 1;
      continue;
    }
    if (arg === "--from" && next) {
      filters.from = next;
      index += 1;
      continue;
    }
    if (arg === "--to" && next) {
      filters.to = next;
      index += 1;
      continue;
    }
    if (arg === "--format" && next) {
      if (next !== "jsonl" && next !== "json" && next !== "bundle") {
        throw new Error(`Unsupported audit export format: ${next}`);
      }
      options.format = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }
  }

  if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 10000)) {
    throw new Error("--limit must be an integer between 1 and 10000.");
  }

  return { filters, options };
}

async function ensureAuditExportAllowed(
  store: Awaited<ReturnType<typeof createLocalPlatform>>["store"],
  filters: ListAuditEventsInput,
): Promise<void> {
  if (!filters.projectId) {
    return;
  }
  const project = await store.getProject(filters.projectId);
  if (!project?.retentionPolicyId) {
    return;
  }
  const policy = await store.getRetentionPolicy(project.retentionPolicyId);
  if (policy && !policy.allowAuditExport) {
    throw new Error(`Retention policy ${policy.name} does not allow audit export for project ${filters.projectId}.`);
  }
}

function parseSecretArgs(args: string[]): { options: SecretCliOptions; positionals: string[] } {
  const options: SecretCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--class" && next) {
      options.class = next as SecretCliOptions["class"];
      index += 1;
      continue;
    }
    if (arg === "--scope-type" && next) {
      options.scopeType = next as SecretCliOptions["scopeType"];
      index += 1;
      continue;
    }
    if (arg === "--scope-id" && next) {
      options.scopeId = next;
      index += 1;
      continue;
    }
    if (arg === "--value-env" && next) {
      options.valueEnv = next;
      index += 1;
      continue;
    }
    if (arg === "--value-file" && next) {
      options.valueFile = next;
      index += 1;
      continue;
    }
    if (arg === "--purpose" && next) {
      options.purpose = next;
      index += 1;
      continue;
    }
    if (arg === "--execution-mode" && next) {
      options.executionMode = next as ExecutionMode;
      index += 1;
      continue;
    }
    if (arg === "--reveal") {
      options.reveal = true;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

async function secretValueFromOptions(options: SecretCliOptions): Promise<string> {
  if (options.valueEnv) {
    const value = process.env[options.valueEnv];
    if (!value) {
      throw new Error(`Missing secret value environment variable: ${options.valueEnv}`);
    }
    return value;
  }
  if (options.valueFile) {
    const { promises: fs } = await import("node:fs");
    return fs.readFile(options.valueFile, "utf8");
  }
  throw new Error("Provide secret value with --value-env or --value-file.");
}

function parseApprovalArgs(args: string[]): { options: ApprovalCliOptions; positionals: string[] } {
  const options: ApprovalCliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--actor" && next) {
      options.actor = next;
      index += 1;
      continue;
    }
    if (arg === "--local-agent") {
      options.localAgent = true;
      continue;
    }
    if (arg === "--auto-replay") {
      options.autoReplay = true;
      continue;
    }
    if (arg === "--auto-resume") {
      options.autoResume = true;
      options.autoReplay = true;
      continue;
    }
    if ((arg === "--queue-resume" || arg === "--enqueue-resume") && next) {
      options.queueResumeWorkerId = next;
      options.autoReplay = true;
      index += 1;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function parseWebArgs(args: string[]): { host?: string; port?: number; token?: string } {
  const options: { host?: string; port?: number; token?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--host" && next) {
      options.host = next;
      index += 1;
      continue;
    }
    if (arg === "--port" && next) {
      const port = Number(next);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid port: ${next}`);
      }
      options.port = port;
      index += 1;
      continue;
    }
    if (arg === "--token" && next) {
      options.token = next;
      index += 1;
    }
  }
  return options;
}

function localUserActor() {
  return { type: "user" as const, id: "local-user", displayName: "Local User" };
}

async function readUtf8(filePath: string): Promise<string> {
  const { promises: fs } = await import("node:fs");
  return fs.readFile(filePath, "utf8");
}

function printWorker(worker: WorkerRegistration): void {
  console.log(
    `${worker.id}\t${worker.status}\tload=${worker.currentLoad}/${worker.maxConcurrentTasks}\tagent=${worker.agentId}\tmachine=${
      worker.machineId
    }\tprojects=${worker.allowedProjects.join(",") || "-"}\texpires=${worker.expiresAt ?? "-"}\t${worker.displayName}`,
  );
}

function printAssignment(assignment: TaskAssignment): void {
  console.log(
    `${assignment.id}\t${assignment.status}\t${assignment.kind}\tworker=${assignment.workerId}\tsession=${
      assignment.sessionId ?? "-"
    }\tsubtask=${assignment.subtaskId ?? "-"}\tlease=${assignment.leaseExpiresAt}\t${assignment.resultSummary ?? ""}`,
  );
}

function printAssignmentRecovery(result: { expired: TaskAssignment[]; retries: TaskAssignment[] }): void {
  console.log(
    JSON.stringify(
      {
        expired: result.expired,
        retries: result.retries,
        expiredCount: result.expired.length,
        retryCount: result.retries.length,
      },
      null,
      2,
    ),
  );
}

function printWorkerRunOnce(result: WorkerRunOnceResult): void {
  if (!result.ran) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    JSON.stringify(
      {
        ran: true,
        workerId: result.workerId,
        completed: result.completed,
        assignment: result.assignment,
        finalAnswer: result.finalAnswer,
      },
      null,
      2,
    ),
  );
}

function printWorkerPoll(result: WorkerPollResult): void {
  console.log(
    JSON.stringify(
      {
        workerId: result.workerId,
        stopReason: result.stopReason,
        runsAttempted: result.runsAttempted,
        assignmentsCompleted: result.assignmentsCompleted,
        idlePolls: result.idlePolls,
        results: result.results,
      },
      null,
      2,
    ),
  );
}

function printSchedulerTick(result: SchedulerTickResult): void {
  console.log(JSON.stringify(result, null, 2));
}

function printSchedulerRun(result: SchedulerRunResult): void {
  console.log(JSON.stringify(result, null, 2));
}

type OperatorCliOptions = {
  json: boolean;
  limit: number;
  details: boolean;
  rows: boolean;
  kind?: OperatorItemKind;
  status?: OperatorStatus;
  severity?: OperatorSeverity;
  id?: string;
  select?: number;
  publicView: boolean;
  actor?: ActorRef;
  positionals: string[];
};

function parseOperatorArgs(args: string[]): OperatorCliOptions {
  const options: OperatorCliOptions = { json: false, limit: 5, details: false, rows: false, publicView: false, positionals: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--rows") {
      options.rows = true;
      continue;
    }
    if (arg === "--limit" && next) {
      const limit = Number(next);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("--limit must be an integer between 1 and 100.");
      }
      options.limit = limit;
      index += 1;
      continue;
    }
    if (arg === "--details") {
      options.details = true;
      continue;
    }
    if (arg === "--public") {
      options.publicView = true;
      continue;
    }
    if (arg === "--actor" && next) {
      options.actor = parseActorRef(next);
      index += 1;
      continue;
    }
    if (arg === "--kind" && next) {
      options.kind = parseOperatorKind(next);
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      options.status = parseOperatorStatus(next);
      index += 1;
      continue;
    }
    if (arg === "--severity" && next) {
      options.severity = parseOperatorSeverity(next);
      index += 1;
      continue;
    }
    if (arg === "--id" && next) {
      options.id = next;
      index += 1;
      continue;
    }
    if (arg === "--select" && next) {
      const select = Number(next);
      if (!Number.isInteger(select) || select < 1 || select > 1000) {
        throw new Error("--select must be an integer between 1 and 1000.");
      }
      options.select = select;
      index += 1;
      continue;
    }
    options.positionals.push(arg);
  }
  return options;
}

function printOperatorView(operator: OperatorViewModel, options: OperatorCliOptions): void {
  console.log(
    [
      `operator\tgenerated=${operator.generatedAt}`,
      `critical=${operator.summary.critical}`,
      `warning=${operator.summary.warning}`,
      `waiting=${operator.summary.waitingForApproval}`,
      `running=${operator.summary.running}`,
      `blocked=${operator.summary.blocked}`,
      `stale=${operator.summary.stale}`,
      `queued=${operator.summary.queued}`,
    ].join("\t"),
  );
  const rows = collectOperatorRows(operator, options);
  for (const section of operatorSections(operator)) {
    printOperatorSection(section.name, rows.filter((row) => row.section === section.name), options);
  }
}

function selectOperatorItem(operator: OperatorViewModel, options: OperatorCliOptions): OperatorItemView | undefined {
  if (options.select === undefined) {
    return undefined;
  }
  const row = collectOperatorRows(operator, options).find((candidate) => candidate.ordinal === options.select);
  if (!row) {
    throw new Error(`Operator selection not found: ${options.select}.`);
  }
  return row.item;
}

function printOperatorSection(name: string, rows: OperatorRowView[], options: OperatorCliOptions): void {
  if (rows.length === 0) {
    return;
  }
  console.log(`\n[${name}]`);
  for (const row of rows) {
    const item = row.item;
    const nextAction = item.nextAction ? `\tnext=${oneLine(item.nextAction, 120)}` : "";
    console.log(`[${row.ordinal}]\t${item.kind}\t${item.status}\t${item.severity}\t${item.id}\t${oneLine(item.label, 80)}\t${oneLine(item.reason, 160)}${nextAction}`);
    if (options.details) {
      if (item.updatedAt) {
        console.log(`  updatedAt=${item.updatedAt}`);
      }
      if (item.refs && Object.keys(item.refs).length > 0) {
        console.log(`  refs=${JSON.stringify(item.refs)}`);
      }
      if (item.metadata && Object.keys(item.metadata).length > 0) {
        console.log(`  metadata=${JSON.stringify(item.metadata)}`);
      }
    }
  }
}

function printOperatorDetail(detail: OperatorDetailView): void {
  const item = detail.item;
  if (!item) {
    return;
  }
  console.log(`${item.kind}\t${item.status}\t${item.severity}\t${item.id}\t${oneLine(item.label, 100)}`);
  console.log(`reason\t${item.reason}`);
  if (item.nextAction) {
    console.log(`next\t${item.nextAction}`);
  }
  if (item.updatedAt) {
    console.log(`updatedAt\t${item.updatedAt}`);
  }
  console.log(`matchedBy\t${detail.matchedBy ?? "id"}`);
  if (detail.detailSections.length > 0) {
    for (const section of detail.detailSections) {
      console.log(`\n[detail:${section.title}]`);
      for (const row of section.rows) {
        console.log(`${row.label}\t${oneLine(row.value, 160)}`);
      }
    }
  }
  if (detail.sourceSummaries.length > 0) {
    console.log("\n[summary]");
    for (const summary of detail.sourceSummaries) {
      console.log(
        [
          summary.source,
          summary.kind,
          summary.id ?? "-",
          summary.status ?? "-",
          summary.count === undefined ? "-" : `count=${summary.count}`,
          summary.label ? oneLine(summary.label, 100) : "-",
        ].join("\t"),
      );
    }
  }
  for (const [name, value] of Object.entries(detail.sources)) {
    console.log(`\n[${name}]`);
    console.log(JSON.stringify(value, null, 2));
  }
  if (detail.missingRefs.length > 0) {
    console.log(`\n[missingRefs]\n${detail.missingRefs.join("\n")}`);
  }
}

function operatorJsonView(
  operator: OperatorViewModel,
  options: OperatorCliOptions,
): OperatorViewModel | { generatedAt: string; filters: Record<string, string | undefined>; items: OperatorItemView[] } | { generatedAt: string; filters: Record<string, string | undefined>; rows: OperatorRowView[] } {
  if (options.rows) {
    return {
      generatedAt: operator.generatedAt,
      filters: operatorJsonFilters(options),
      rows: collectOperatorRows(operator, options),
    };
  }
  if (!hasOperatorFilters(options)) {
    return operator;
  }
  return {
    generatedAt: operator.generatedAt,
    filters: operatorJsonFilters(options),
    items: operatorSections(operator)
      .flatMap((section) => section.items)
      .filter((item) => operatorItemMatches(item, options))
      .slice(0, options.limit),
  };
}

function operatorJsonFilters(options: OperatorCliOptions): Record<string, string | undefined> {
  return {
    kind: options.kind,
    status: options.status,
    severity: options.severity,
    id: options.id,
    projection: options.publicView ? "public" : undefined,
    actor: options.actor ? `${options.actor.type}:${options.actor.id}` : undefined,
  };
}

function parseOperatorKind(value: string): OperatorItemKind {
  const allowed: OperatorItemKind[] = ["approval", "assignment", "worker", "agent", "session", "queue", "mcp", "artifact", "retention", "spec", "scheduler", "audit"];
  if (allowed.includes(value as OperatorItemKind)) {
    return value as OperatorItemKind;
  }
  throw new Error(`Invalid operator kind: ${value}.`);
}

function parseOperatorStatus(value: string): OperatorStatus {
  const allowed: OperatorStatus[] = ["healthy", "idle", "running", "queued", "waiting_for_approval", "paused", "retry_delayed", "draining", "blocked", "saturated", "stale", "failed", "completed", "offline", "unknown"];
  if (allowed.includes(value as OperatorStatus)) {
    return value as OperatorStatus;
  }
  throw new Error(`Invalid operator status: ${value}.`);
}

function parseOperatorSeverity(value: string): OperatorSeverity {
  if (value === "ok" || value === "info" || value === "warning" || value === "critical") {
    return value;
  }
  throw new Error(`Invalid operator severity: ${value}.`);
}

function oneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
}

function parseActorRef(value?: string): ActorRef {
  if (!value) {
    return localUserActor();
  }
  const [type, id] = value.includes(":") ? value.split(":", 2) : ["user", value];
  if (!id) {
    throw new Error(`Invalid actor: ${value}`);
  }
  if (!["user", "agent", "service_account", "git_provider_bot", "system"].includes(type)) {
    throw new Error(`Invalid actor type: ${type}`);
  }
  return { type: type as ActorRef["type"], id, displayName: id };
}

function parseCapabilitySubject(value: string): { subjectType: CapabilityGrant["subjectType"]; subjectId: string } {
  const actor = parseActorRef(value);
  if (actor.type !== "user" && actor.type !== "agent" && actor.type !== "service_account") {
    throw new Error(`Invalid capability subject type: ${actor.type}`);
  }
  return { subjectType: actor.type, subjectId: actor.id };
}

function parseCapabilityScope(value: string): CapabilityGrant["scopeType"] {
  if (value === "organization" || value === "project" || value === "room" || value === "session" || value === "operator") {
    return value;
  }
  throw new Error(`Invalid capability scope type: ${value}`);
}

function agentActor(agent: { id: string; displayName: string }) {
  return { type: "agent" as const, id: agent.id, displayName: agent.displayName };
}

function roomRoutingDiagnostics(metadata: Record<string, unknown> | undefined): RoomRoutingDiagnostic[] {
  const diagnostics = metadata?.routingDiagnostics;
  if (!Array.isArray(diagnostics)) {
    return [];
  }
  return diagnostics.filter(
    (diagnostic): diagnostic is RoomRoutingDiagnostic =>
      typeof diagnostic === "object" &&
      diagnostic !== null &&
      typeof (diagnostic as RoomRoutingDiagnostic).code === "string" &&
      typeof (diagnostic as RoomRoutingDiagnostic).raw === "string" &&
      typeof (diagnostic as RoomRoutingDiagnostic).message === "string",
  );
}

async function resolveActor(store: Awaited<ReturnType<typeof createLocalPlatform>>["store"], actor: ActorRef): Promise<ActorRef> {
  if (actor.type !== "agent") {
    return actor;
  }
  const agent = await store.getAgent(actor.id);
  return {
    ...actor,
    displayName: agent?.displayName ?? actor.displayName,
  };
}

async function parseToolInput(toolName: string, text: string, inputFile?: string) {
  if (inputFile) {
    const { promises: fs } = await import("node:fs");
    return JSON.parse(await fs.readFile(inputFile, "utf8")) as Record<string, unknown>;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  switch (toolName) {
    case "run_command":
      return { command: text };
    case "apply_patch":
      return { patch: text };
    case "list_files":
      return { path: text || "." };
    case "read_file":
      return { path: text };
    case "search_text":
      return { query: text };
    default:
      return {};
  }
}

async function parsePluginInput(text: string, inputFile?: string) {
  if (inputFile) {
    const { promises: fs } = await import("node:fs");
    return JSON.parse(await fs.readFile(inputFile, "utf8")) as Record<string, unknown>;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  return { text };
}

await main();

