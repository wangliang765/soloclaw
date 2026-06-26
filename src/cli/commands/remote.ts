import { promises as fs } from "node:fs";
import path from "node:path";
import { DaemonLifecycleController, type DaemonLifecycleSnapshot } from "../../daemon/daemon-lifecycle.js";
import type { ActorRef, AgentHeartbeatStatus, RoomMessageKind, RoomRole } from "../../domain/index.js";
import { RemoteRoomRunner, type RemoteRoomPollResult, type RemoteRoomRunResult } from "../../remote/remote-room-runner.js";
import type { CommandModule } from "../command-router.js";

type RemoteCommandLocalAgent = {
  id: string;
  displayName: string;
  machineId?: string;
  orgId?: string;
  publicKeyPem?: string;
  fingerprint?: string;
  capabilities?: string[];
  allowedProjects?: string[];
  trustStatus?: string;
};

type RemoteCommandPlatform = {
  identity: unknown;
  localAgent: RemoteCommandLocalAgent;
  store: { close(): void };
  locks: { close(): void };
};

export type RemoteCommandDeps<TPlatform extends RemoteCommandPlatform> = {
  cwd(): string;
  env: NodeJS.ProcessEnv;
  createPlatform(cwd: string): Promise<TPlatform>;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createRemoteCommand<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
): CommandModule<void> {
  return {
    name: "remote",
    summary: "Run remote room agent enrollment and inbox commands",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "help";
      const args = rawArgs.slice(1);

      if (subcommand === "register") {
        const parsed = parseRemoteArgs(args);
        if (!parsed.options.controlUrl) {
          return fail(deps, "Usage: agent remote register --control-url url [--control-token token] [--display-name name] [--json]");
        }
        const controlToken = resolveControlToken(deps, parsed.options);
        if (!controlToken) {
          return fail(deps, "Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        }
        const platform = await deps.createPlatform(deps.cwd());
        const { identity, localAgent, store, locks } = platform;
        try {
          const shown = await (identity as { show(): Promise<{ privateKeyPath: string }> }).show();
          const displayName = parsed.options.displayName ?? localAgent.displayName;
          const actor = `agent:${localAgent.id}`;
          const registration = await controlPlaneJson<{ agent: RemoteCommandLocalAgent }>(parsed.options.controlUrl, "/api/agents/register", controlToken, {
            actor,
            agentId: localAgent.id,
            machineId: localAgent.machineId,
            orgId: localAgent.orgId,
            displayName,
            publicKeyPem: localAgent.publicKeyPem,
            fingerprint: localAgent.fingerprint,
            capabilities: localAgent.capabilities ?? [],
            allowedProjects: localAgent.allowedProjects ?? [],
          });
          const result = {
            agent: registration.agent,
            privateKeyPath: shown.privateKeyPath,
          };
          writeRemoteResult(deps, parsed.options, result, `agent\t${registration.agent.id}\t${registration.agent.trustStatus}\t${registration.agent.fingerprint}`);
        } catch (error) {
          handleError(deps, error);
        } finally {
          locks.close();
          store.close();
        }
        return { matched: true };
      }

      if (subcommand === "enroll") {
        const parsed = parseRemoteArgs(args);
        if (!parsed.options.controlUrl || !parsed.options.roomId || !parsed.options.inviteToken) {
          return fail(deps, "Usage: agent remote enroll --control-url url [--control-token token] --room room-id --invite-token token [--alias alias] [--display-name name] [--json]");
        }
        const controlToken = resolveControlToken(deps, parsed.options);
        if (!controlToken) {
          return fail(deps, "Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        }
        const platform = await deps.createPlatform(deps.cwd());
        const { identity, localAgent, store, locks } = platform;
        try {
          const shown = await (identity as { show(): Promise<{ privateKeyPath: string }> }).show();
          const displayName = parsed.options.displayName ?? localAgent.displayName;
          const actor = `agent:${localAgent.id}`;
          const registration = await controlPlaneJson<{ agent: RemoteCommandLocalAgent }>(parsed.options.controlUrl, "/api/agents/register", controlToken, {
            actor,
            agentId: localAgent.id,
            machineId: localAgent.machineId,
            orgId: localAgent.orgId,
            displayName,
            publicKeyPem: localAgent.publicKeyPem,
            fingerprint: localAgent.fingerprint,
            capabilities: localAgent.capabilities ?? [],
            allowedProjects: localAgent.allowedProjects ?? [],
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
            deps.writeJson(result);
          } else {
            deps.writeText(`agent\t${registration.agent.id}\t${registration.agent.trustStatus}\t${registration.agent.fingerprint}`);
            deps.writeText(`member\t${join.member.actor.type}:${join.member.actor.id}\t${join.member.role}\t${join.member.status}\t${(join.member.aliases ?? []).join(",")}`);
          }
        } catch (error) {
          handleError(deps, error);
        } finally {
          locks.close();
          store.close();
        }
        return { matched: true };
      }

      if (subcommand === "join-bundle") {
        const parsed = parseRemoteArgs(args);
        if (!parsed.options.inviteBundlePath) {
          return fail(deps, "Usage: agent remote join-bundle --invite-bundle path [--control-token token] [--alias alias] [--display-name name] [--run] [--status-file path] [--stop-file path] [run options] [--json]");
        }
        let platform: TPlatform | undefined;
        try {
          const bundle = await readRemoteInviteBundle(parsed.options.inviteBundlePath);
          const controlUrl = parsed.options.controlUrl ?? bundle.controlUrl;
          const controlToken = parsed.options.controlToken ?? bundle.controlToken ?? deps.env.AGENT_CONTROL_TOKEN ?? deps.env.AGENT_WEB_TOKEN;
          const roomId = parsed.options.roomId ?? bundle.roomId;
          const inviteToken = parsed.options.inviteToken ?? bundle.inviteToken;
          if (!controlUrl || !roomId || !inviteToken) {
            throw new Error("Invite bundle is missing controlUrl, roomId, or inviteToken.");
          }
          if (!controlToken) {
            throw new Error("Missing control token. Use --control-token, AGENT_CONTROL_TOKEN, or a bundle with controlToken.");
          }
          const stopFileLifecycle = parsed.options.stopFilePath
            ? createRemoteRunnerStopFileLifecycle(deps.cwd(), parsed.options.stopFilePath)
            : undefined;
          platform = await deps.createPlatform(deps.cwd());
          const { identity, localAgent } = platform;
          const displayName = parsed.options.displayName ?? bundle.displayName ?? localAgent.displayName;
          const aliases = parsed.options.aliases?.length ? parsed.options.aliases : bundle.aliases ?? [];
          const actor = `agent:${localAgent.id}`;
          const registration = await controlPlaneJson<{ agent: RemoteCommandLocalAgent }>(controlUrl, "/api/agents/register", controlToken, {
            actor,
            agentId: localAgent.id,
            machineId: localAgent.machineId,
            orgId: localAgent.orgId,
            displayName,
            publicKeyPem: localAgent.publicKeyPem,
            fingerprint: localAgent.fingerprint,
            capabilities: localAgent.capabilities ?? [],
            allowedProjects: localAgent.allowedProjects ?? [],
          });
          const join = await controlPlaneJson<{ member: { actor: ActorRef; role: string; status: string; aliases?: string[] } }>(
            controlUrl,
            `/api/rooms/${encodeURIComponent(roomId)}/join-invite`,
            controlToken,
            {
              actor,
              token: inviteToken,
              aliases,
            },
          );
          const runner = new RemoteRoomRunner({
            controlUrl,
            token: controlToken,
            roomId,
            identity: identity as ConstructorParameters<typeof RemoteRoomRunner>[0]["identity"],
            localAgent: localAgent as ConstructorParameters<typeof RemoteRoomRunner>[0]["localAgent"],
          });
          const heartbeat = await runner.heartbeat({
            status: parsed.options.heartbeatStatus ?? "online",
            ttlSeconds: parsed.options.ttlSeconds ?? bundle.defaultRun?.heartbeatTtlSeconds ?? 60,
          });
          const statusReporter = parsed.options.statusFilePath
            ? createRemoteRunnerStatusReporter({
                cwd: deps.cwd(),
                statusFilePath: parsed.options.statusFilePath,
                roomId,
                agentId: localAgent.id,
                machineId: localAgent.machineId,
              })
            : undefined;
          await statusReporter?.write({ status: parsed.options.runAfterJoin ? "starting" : "joined", messagesProcessed: 0, errorCount: 0 });
          let runResult: RemoteRoomRunResult | undefined;
          if (parsed.options.runAfterJoin) {
            await stopFileLifecycle?.requestShutdownIfStopFilePresent();
            runResult = await runner.run({
              maxCycles: parsed.options.maxCycles ?? bundle.defaultRun?.cycles ?? 10,
              maxMessagesPerPoll: parsed.options.limit ?? bundle.defaultRun?.limit ?? 10,
              maxIdlePolls: parsed.options.maxIdlePolls ?? bundle.defaultRun?.idleLimit ?? 1,
              idleIntervalMs: parsed.options.idleIntervalMs ?? bundle.defaultRun?.intervalMs ?? 1000,
              intervalMs: parsed.options.loopIntervalMs ?? bundle.defaultRun?.loopIntervalMs ?? 1000,
              stopWhenIdle: parsed.options.stopWhenIdle ?? bundle.defaultRun?.stopWhenIdle ?? true,
              maxIdleCycles: parsed.options.maxIdleCycles ?? bundle.defaultRun?.idleCycles ?? 1,
              baseBackoffMs: parsed.options.baseBackoffMs ?? bundle.defaultRun?.backoffMs ?? 1000,
              maxBackoffMs: parsed.options.maxBackoffMs ?? bundle.defaultRun?.maxBackoffMs ?? 30000,
              maxErrors: parsed.options.maxErrors ?? bundle.defaultRun?.maxErrors ?? 3,
              heartbeatTtlSeconds: parsed.options.heartbeatTtlSeconds ?? bundle.defaultRun?.heartbeatTtlSeconds ?? 60,
              lifecycle: stopFileLifecycle?.lifecycle,
              onMessage: parsed.options.replyTemplate
                ? async (message) => {
                    await runner.say({
                      kind: "chat",
                      body: formatRemoteReplyTemplate(parsed.options.replyTemplate!, message, {
                        roomId,
                        agentId: localAgent.id,
                      }),
                    });
                  }
                : undefined,
              onPoll: async (poll) => {
                await statusReporter?.recordPoll(poll);
                await stopFileLifecycle?.requestShutdownIfStopFilePresent();
              },
              onError: async (error, cycle) => {
                await statusReporter?.recordError(error, cycle);
                await stopFileLifecycle?.requestShutdownIfStopFilePresent();
              },
            });
            await statusReporter?.recordStop(runResult);
          }
          const bootstrapEvidence = {
            inviteBundleKind: bundle.kind,
            inviteSignatureStatus: bundle.inviteSignatureStatus ?? "unknown",
            joinedFromInviteBundle: join.member.actor.id === localAgent.id && join.member.status === "active",
            ranFromInviteBundle: Boolean(runResult),
          };
          const result = {
            agent: registration.agent,
            member: join.member,
            heartbeat,
            run: runResult,
            bootstrapEvidence,
          };
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            deps.writeText(`agent\t${registration.agent.id}\t${registration.agent.trustStatus}\t${registration.agent.fingerprint}`);
            deps.writeText(`member\t${join.member.actor.type}:${join.member.actor.id}\t${join.member.role}\t${join.member.status}\t${(join.member.aliases ?? []).join(",")}`);
            deps.writeText(`heartbeat\t${heartbeat.agent.id}\t${heartbeat.agent.heartbeatStatus ?? "-"}\texpires=${heartbeat.agent.heartbeatExpiresAt ?? "-"}`);
            deps.writeText(`bootstrap\tbundle=${bootstrapEvidence.inviteBundleKind}\tsignature=${bootstrapEvidence.inviteSignatureStatus}\tjoined=${bootstrapEvidence.joinedFromInviteBundle}\tran=${bootstrapEvidence.ranFromInviteBundle}`);
            if (runResult) {
              deps.writeText(`run\t${runResult.agentId}\t${runResult.stopReason}\tcycles=${runResult.cycles}\tprocessed=${runResult.messagesProcessed}\terrors=${runResult.errors.length}`);
            }
          }
        } catch (error) {
          handleError(deps, error);
        } finally {
          platform?.locks.close();
          platform?.store.close();
        }
        return { matched: true };
      }

      if (subcommand === "invitations" || subcommand === "invites") {
        const parsed = parseRemoteArgs(args);
        if (!parsed.options.controlUrl) {
          return fail(deps, "Usage: agent remote invitations --control-url url [--control-token token] [--json]");
        }
        const controlToken = resolveControlToken(deps, parsed.options);
        if (!controlToken) {
          return fail(deps, "Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        }
        const platform = await deps.createPlatform(deps.cwd());
        const { localAgent, store, locks } = platform;
        try {
          const result = await controlPlaneGetJson<{
            generatedAt: string;
            agent: RemoteCommandLocalAgent;
            invitations: Array<{ room: { id: string; name: string }; member: { role: string; status: string; aliases?: string[] } }>;
          }>(parsed.options.controlUrl, `/api/agents/${encodeURIComponent(localAgent.id)}/room-invitations`, controlToken);
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            for (const invitation of result.invitations) {
              deps.writeText(`${invitation.room.id}\t${invitation.member.role}\t${invitation.member.status}\taliases=${invitation.member.aliases?.join(",") ?? ""}\t${invitation.room.name}`);
            }
          }
        } catch (error) {
          handleError(deps, error);
        } finally {
          locks.close();
          store.close();
        }
        return { matched: true };
      }

      if (subcommand === "accept-room") {
        const parsed = parseRemoteArgs(args);
        if (!parsed.options.controlUrl || !parsed.options.roomId) {
          return fail(deps, "Usage: agent remote accept-room --control-url url [--control-token token] --room room-id [--alias alias] [--run] [--status-file path] [--stop-file path] [run options] [--json]");
        }
        const controlToken = resolveControlToken(deps, parsed.options);
        if (!controlToken) {
          return fail(deps, "Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
        }
        let platform: TPlatform | undefined;
        try {
          const stopFileLifecycle = parsed.options.stopFilePath
            ? createRemoteRunnerStopFileLifecycle(deps.cwd(), parsed.options.stopFilePath)
            : undefined;
          platform = await deps.createPlatform(deps.cwd());
          const { identity, localAgent } = platform;
          const accept = await controlPlaneJson<{ member: { actor: ActorRef; role: string; status: string; aliases?: string[] } }>(
            parsed.options.controlUrl,
            `/api/rooms/${encodeURIComponent(parsed.options.roomId)}/members/${encodeURIComponent(localAgent.id)}/accept-invitation`,
            controlToken,
            {
              actor: `agent:${localAgent.id}`,
              aliases: parsed.options.aliases,
            },
          );
          const runner = new RemoteRoomRunner({
            controlUrl: parsed.options.controlUrl,
            token: controlToken,
            roomId: parsed.options.roomId,
            identity: identity as ConstructorParameters<typeof RemoteRoomRunner>[0]["identity"],
            localAgent: localAgent as ConstructorParameters<typeof RemoteRoomRunner>[0]["localAgent"],
          });
          const heartbeat = await runner.heartbeat({
            status: parsed.options.heartbeatStatus ?? "online",
            ttlSeconds: parsed.options.ttlSeconds ?? parsed.options.heartbeatTtlSeconds ?? 60,
          });
          const statusReporter = parsed.options.statusFilePath
            ? createRemoteRunnerStatusReporter({
                cwd: deps.cwd(),
                statusFilePath: parsed.options.statusFilePath,
                roomId: parsed.options.roomId,
                agentId: localAgent.id,
                machineId: localAgent.machineId,
              })
            : undefined;
          await statusReporter?.write({ status: parsed.options.runAfterJoin ? "starting" : "joined", messagesProcessed: 0, errorCount: 0 });
          let runResult: RemoteRoomRunResult | undefined;
          if (parsed.options.runAfterJoin) {
            await stopFileLifecycle?.requestShutdownIfStopFilePresent();
            runResult = await runner.run({
              maxCycles: parsed.options.maxCycles ?? 10,
              maxMessagesPerPoll: parsed.options.limit ?? 10,
              maxIdlePolls: parsed.options.maxIdlePolls ?? 1,
              idleIntervalMs: parsed.options.idleIntervalMs ?? 1000,
              intervalMs: parsed.options.loopIntervalMs ?? 1000,
              stopWhenIdle: parsed.options.stopWhenIdle ?? true,
              maxIdleCycles: parsed.options.maxIdleCycles ?? 1,
              baseBackoffMs: parsed.options.baseBackoffMs ?? 1000,
              maxBackoffMs: parsed.options.maxBackoffMs ?? 30000,
              maxErrors: parsed.options.maxErrors ?? 3,
              heartbeatTtlSeconds: parsed.options.heartbeatTtlSeconds ?? 60,
              lifecycle: stopFileLifecycle?.lifecycle,
              onMessage: parsed.options.replyTemplate
                ? async (message) => {
                    await runner.say({
                      kind: "chat",
                      body: formatRemoteReplyTemplate(parsed.options.replyTemplate!, message, {
                        roomId: parsed.options.roomId!,
                        agentId: localAgent.id,
                      }),
                    });
                  }
                : undefined,
              onPoll: async (poll) => {
                await statusReporter?.recordPoll(poll);
                await stopFileLifecycle?.requestShutdownIfStopFilePresent();
              },
              onError: async (error, cycle) => {
                await statusReporter?.recordError(error, cycle);
                await stopFileLifecycle?.requestShutdownIfStopFilePresent();
              },
            });
            await statusReporter?.recordStop(runResult);
          }
          const pullEvidence = {
            acceptedFromRoomInvitation: accept.member.actor.id === localAgent.id && accept.member.status === "active",
            ranFromRoomInvitation: Boolean(runResult),
          };
          const result = {
            agent: localAgent,
            member: accept.member,
            heartbeat,
            run: runResult,
            pullEvidence,
          };
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            deps.writeText(`member\t${accept.member.actor.type}:${accept.member.actor.id}\t${accept.member.role}\t${accept.member.status}\t${(accept.member.aliases ?? []).join(",")}`);
            deps.writeText(`heartbeat\t${heartbeat.agent.id}\t${heartbeat.agent.heartbeatStatus ?? "-"}\texpires=${heartbeat.agent.heartbeatExpiresAt ?? "-"}`);
            deps.writeText(`pull\taccepted=${pullEvidence.acceptedFromRoomInvitation}\tran=${pullEvidence.ranFromRoomInvitation}`);
            if (runResult) {
              deps.writeText(`run\t${runResult.agentId}\t${runResult.stopReason}\tcycles=${runResult.cycles}\tprocessed=${runResult.messagesProcessed}\terrors=${runResult.errors.length}`);
            }
          }
        } catch (error) {
          handleError(deps, error);
        } finally {
          platform?.locks.close();
          platform?.store.close();
        }
        return { matched: true };
      }

      if (subcommand === "inbox" || subcommand === "say" || subcommand === "ack" || subcommand === "poll" || subcommand === "heartbeat") {
        return executeRunnerCommand(deps, subcommand, args);
      }

      if (subcommand === "service" || subcommand === "daemon") {
        const parsed = parseRemoteArgs(args);
        if (!parsed.options.controlUrl || !parsed.options.roomId) {
          return fail(deps, "Usage: agent remote service --control-url url --room room-id [--control-token token] [--cycles n] [--limit n] [--idle-limit n] [--interval-ms n] [--loop-interval-ms n] [--stop-when-idle] [--idle-cycles n] [--heartbeat-ttl seconds] [--status-file path] [--stop-file path] [--json]");
        }
        try {
          const plan = buildRemoteRoomServicePlan({
            workspace: deps.cwd(),
            controlUrl: parsed.options.controlUrl,
            roomId: parsed.options.roomId,
            options: parsed.options,
          });
          if (parsed.options.json) {
            deps.writeJson(plan);
          } else {
            printRemoteRoomServicePlan(deps, plan);
          }
        } catch (error) {
          handleError(deps, error);
        }
        return { matched: true };
      }

      if (subcommand === "run") {
        return executeRemoteRunCommand(deps, args);
      }

      return fail(deps, `Unknown remote command: ${subcommand}`);
    },
  };
}

async function executeRunnerCommand<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  subcommand: string,
  args: string[],
) {
  const parsed = parseRemoteArgs(args);
  const body = parsed.positionals.join(" ").trim();
  if (!parsed.options.controlUrl || !parsed.options.roomId || (subcommand === "say" && !body)) {
    const usage = subcommand === "say"
      ? "Usage: agent remote say --control-url url [--control-token token] --room room-id [--kind chat|task|decision|tool_request|approval|artifact|system] <message>"
      : subcommand === "ack"
        ? "Usage: agent remote ack --control-url url [--control-token token] --room room-id [--message-id message-id] [--json]"
        : subcommand === "poll"
          ? "Usage: agent remote poll --control-url url [--control-token token] --room room-id [--limit n] [--idle-limit n] [--interval-ms n] [--json]"
          : subcommand === "heartbeat"
            ? "Usage: agent remote heartbeat --control-url url [--control-token token] --room room-id [--status online|idle|running|error|offline] [--ttl seconds] [--last-error text] [--json]"
            : "Usage: agent remote inbox --control-url url [--control-token token] --room room-id [--limit n] [--include-delivered] [--json]";
    return fail(deps, usage);
  }
  const controlToken = resolveControlToken(deps, parsed.options);
  if (!controlToken) {
    return fail(deps, "Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
  }
  const platform = await deps.createPlatform(deps.cwd());
  const { identity, localAgent, store, locks } = platform;
  try {
    const runner = new RemoteRoomRunner({
      controlUrl: parsed.options.controlUrl,
      token: controlToken,
      roomId: parsed.options.roomId,
      identity: identity as ConstructorParameters<typeof RemoteRoomRunner>[0]["identity"],
      localAgent: localAgent as ConstructorParameters<typeof RemoteRoomRunner>[0]["localAgent"],
    });
    if (subcommand === "inbox") {
      const inbox = await runner.inbox({ limit: parsed.options.limit ?? 50, includeDelivered: parsed.options.includeDelivered });
      if (parsed.options.json) {
        deps.writeJson(inbox);
      } else {
        for (const message of inbox.messages) {
          deps.writeText(`${message.id}\t${message.kind}\t${message.signatureStatus ?? "-"}\t${message.activationContext?.reason ?? "-"}\t${message.createdAt}\t${message.body.replace(/\s+/g, " ").slice(0, 160)}`);
        }
      }
      return { matched: true };
    }
    if (subcommand === "say") {
      const result = await runner.say({ kind: parsed.options.kind ?? "chat", body });
      if (parsed.options.json) {
        deps.writeJson(result);
      } else {
        deps.writeText(`${result.message.id}\t${result.message.roomId}\t${result.message.sender.type}:${result.message.sender.id}\t${result.message.kind}\t${result.message.body}`);
      }
      return { matched: true };
    }
    if (subcommand === "ack") {
      const messageId = parsed.options.messageId ?? (await runner.latestInboxMessageId());
      if (!messageId) {
        throw new Error("No routed inbox message to acknowledge.");
      }
      const result = await runner.ack(messageId);
      if (parsed.options.json) {
        deps.writeJson(result);
      } else {
        deps.writeText(`ack\t${result.cursor.agentId}\t${result.cursor.lastDeliveredMessageId}\t${result.cursor.lastAckEnvelope?.signature ? "signed" : "unsigned"}`);
      }
      return { matched: true };
    }
    if (subcommand === "poll") {
      const result = await runner.poll({
        maxMessages: parsed.options.limit ?? 10,
        maxIdlePolls: parsed.options.maxIdlePolls ?? 1,
        idleIntervalMs: parsed.options.idleIntervalMs ?? 1000,
        onMessage: parsed.options.json
          ? undefined
          : (message, ack) => {
              deps.writeText(`${message.id}\t${message.kind}\t${message.signatureStatus ?? "-"}\t${message.activationContext?.reason ?? "-"}\t${message.createdAt}\t${message.body.replace(/\s+/g, " ").slice(0, 160)}`);
              deps.writeText(`ack\t${ack.cursor.agentId}\t${ack.cursor.lastDeliveredMessageId}\t${ack.cursor.lastAckEnvelope?.signature ? "signed" : "unsigned"}`);
            },
      });
      if (parsed.options.json) {
        deps.writeJson(result);
      } else {
        deps.writeText(`poll\t${result.agentId}\t${result.stopReason}\tprocessed=${result.messagesProcessed}\tidle=${result.idlePolls}`);
      }
      return { matched: true };
    }
    const result = await runner.heartbeat({
      status: parsed.options.heartbeatStatus ?? "online",
      ttlSeconds: parsed.options.ttlSeconds ?? 60,
      lastError: parsed.options.lastError,
    });
    if (parsed.options.json) {
      deps.writeJson(result);
    } else {
      deps.writeText(`heartbeat\t${result.agent.id}\t${result.agent.heartbeatStatus ?? "-"}\texpires=${result.agent.heartbeatExpiresAt ?? "-"}`);
    }
  } catch (error) {
    handleError(deps, error);
  } finally {
    locks.close();
    store.close();
  }
  return { matched: true };
}

async function executeRemoteRunCommand<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  args: string[],
) {
  const parsed = parseRemoteArgs(args);
  if (!parsed.options.controlUrl || !parsed.options.roomId) {
    return fail(deps, "Usage: agent remote run --control-url url [--control-token token] --room room-id [--cycles n] [--limit n] [--idle-limit n] [--interval-ms n] [--loop-interval-ms n] [--stop-when-idle] [--idle-cycles n] [--backoff-ms n] [--max-backoff-ms n] [--max-errors n] [--heartbeat-ttl seconds] [--reply-template text] [--status-file path] [--stop-file path] [--json]");
  }
  const controlToken = resolveControlToken(deps, parsed.options);
  if (!controlToken) {
    return fail(deps, "Missing control token. Use --control-token or AGENT_CONTROL_TOKEN.");
  }
  const platform = await deps.createPlatform(deps.cwd());
  const { identity, localAgent, store, locks } = platform;
  try {
    const runner = new RemoteRoomRunner({
      controlUrl: parsed.options.controlUrl,
      token: controlToken,
      roomId: parsed.options.roomId,
      identity: identity as ConstructorParameters<typeof RemoteRoomRunner>[0]["identity"],
      localAgent: localAgent as ConstructorParameters<typeof RemoteRoomRunner>[0]["localAgent"],
    });
    const statusReporter = parsed.options.statusFilePath
      ? createRemoteRunnerStatusReporter({
          cwd: deps.cwd(),
          statusFilePath: parsed.options.statusFilePath,
          roomId: parsed.options.roomId,
          agentId: localAgent.id,
          machineId: localAgent.machineId,
        })
      : undefined;
    await statusReporter?.write({ status: "starting", messagesProcessed: 0, errorCount: 0 });
    const stopFileLifecycle = parsed.options.stopFilePath
      ? createRemoteRunnerStopFileLifecycle(deps.cwd(), parsed.options.stopFilePath)
      : undefined;
    await stopFileLifecycle?.requestShutdownIfStopFilePresent();
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
      lifecycle: stopFileLifecycle?.lifecycle,
      onMessage: parsed.options.replyTemplate
        ? async (message) => {
            const reply = await runner.say({
              kind: "chat",
              body: formatRemoteReplyTemplate(parsed.options.replyTemplate!, message, {
                roomId: parsed.options.roomId!,
                agentId: localAgent.id,
              }),
            });
            if (!parsed.options.json) {
              deps.writeText(`reply\t${reply.message.id}\t${reply.message.kind}\t${reply.message.body}`);
            }
          }
        : undefined,
      onPoll: async (poll) => {
        await statusReporter?.recordPoll(poll);
        await stopFileLifecycle?.requestShutdownIfStopFilePresent();
        if (!parsed.options.json) {
          deps.writeText(`cycle\t${poll.agentId}\t${poll.stopReason}\tprocessed=${poll.messagesProcessed}\tidle=${poll.idlePolls}`);
          for (const ack of poll.acknowledgements) {
            deps.writeText(`ack\t${poll.agentId}\t${ack.messageId}\t${ack.ackSignature ? "signed" : "unsigned"}`);
          }
        }
      },
      onError: async (error, cycle) => {
        await statusReporter?.recordError(error, cycle);
        await stopFileLifecycle?.requestShutdownIfStopFilePresent();
        if (!parsed.options.json) {
          deps.writeError(`cycle-error\t${cycle}\t${error.message}`);
        }
      },
    });
    await statusReporter?.recordStop(result);
    if (parsed.options.json) {
      deps.writeJson(result);
    } else {
      deps.writeText(`run\t${result.agentId}\t${result.stopReason}\tcycles=${result.cycles}\tprocessed=${result.messagesProcessed}\terrors=${result.errors.length}`);
    }
  } catch (error) {
    handleError(deps, error);
  } finally {
    locks.close();
    store.close();
  }
  return { matched: true };
}

function resolveControlToken<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  options: RemoteCliOptions,
): string | undefined {
  return options.controlToken ?? deps.env.AGENT_CONTROL_TOKEN ?? deps.env.AGENT_WEB_TOKEN;
}

function writeRemoteResult<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  options: RemoteCliOptions,
  json: unknown,
  text: string,
): void {
  if (options.json) {
    deps.writeJson(json);
  } else {
    deps.writeText(text);
  }
}

function fail<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  message: string,
) {
  deps.writeError(message);
  deps.setExitCode(1);
  return { matched: true };
}

function handleError<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  error: unknown,
): void {
  deps.writeError(error instanceof Error ? error.message : String(error));
  deps.setExitCode(1);
}

async function controlPlaneGetJson<T>(controlUrl: string, requestPath: string, token: string): Promise<T> {
  const url = new URL(requestPath, controlUrl.endsWith("/") ? controlUrl : `${controlUrl}/`);
  const response = await fetch(url, {
    headers: {
      "x-agent-control-token": token,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(`Control plane ${response.status}: ${payload.error ?? response.statusText}`);
  }
  return payload as T;
}

async function controlPlaneJson<T>(controlUrl: string, requestPath: string, token: string, body: Record<string, unknown>): Promise<T> {
  const url = new URL(requestPath, controlUrl.endsWith("/") ? controlUrl : `${controlUrl}/`);
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

function formatRemoteReplyTemplate(
  template: string,
  message: { id: string; kind: string; body: string; createdAt: string },
  context: { roomId: string; agentId: string },
): string {
  return template
    .replaceAll("{messageId}", message.id)
    .replaceAll("{kind}", message.kind)
    .replaceAll("{body}", message.body)
    .replaceAll("{createdAt}", message.createdAt)
    .replaceAll("{roomId}", context.roomId)
    .replaceAll("{agentId}", context.agentId);
}

type RemoteInviteBundle = {
  kind: "soloclaw.room_invite";
  version: 1;
  controlUrl: string;
  controlToken?: string;
  roomId: string;
  inviteToken: string;
  inviteId?: string;
  inviteSignatureStatus?: string;
  role?: RoomRole;
  aliases?: string[];
  displayName?: string;
  expiresAt?: string;
  maxUses?: number;
  sensitivity?: string;
  defaultRun?: {
    cycles?: number;
    limit?: number;
    idleLimit?: number;
    intervalMs?: number;
    loopIntervalMs?: number;
    stopWhenIdle?: boolean;
    idleCycles?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    maxErrors?: number;
    heartbeatTtlSeconds?: number;
  };
  commands?: {
    enroll: string;
    run: string;
  };
};

async function readRemoteInviteBundle(filePath: string): Promise<RemoteInviteBundle> {
  const parsed = JSON.parse(await readUtf8(filePath)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invite bundle must be a JSON object.");
  }
  if (parsed.kind !== "soloclaw.room_invite" || parsed.version !== 1) {
    throw new Error("Invite bundle must have kind=soloclaw.room_invite and version=1.");
  }
  const controlUrl = requiredBundleString(parsed.controlUrl, "controlUrl");
  const roomId = requiredBundleString(parsed.roomId, "roomId");
  const inviteToken = requiredBundleString(parsed.inviteToken, "inviteToken");
  const aliases = Array.isArray(parsed.aliases)
    ? parsed.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
    : [];
  const defaultRun = isRecord(parsed.defaultRun)
    ? {
        cycles: optionalBundleNumber(parsed.defaultRun.cycles),
        limit: optionalBundleNumber(parsed.defaultRun.limit),
        idleLimit: optionalBundleNumber(parsed.defaultRun.idleLimit),
        intervalMs: optionalBundleNumber(parsed.defaultRun.intervalMs),
        loopIntervalMs: optionalBundleNumber(parsed.defaultRun.loopIntervalMs),
        stopWhenIdle: typeof parsed.defaultRun.stopWhenIdle === "boolean" ? parsed.defaultRun.stopWhenIdle : undefined,
        idleCycles: optionalBundleNumber(parsed.defaultRun.idleCycles),
        backoffMs: optionalBundleNumber(parsed.defaultRun.backoffMs),
        maxBackoffMs: optionalBundleNumber(parsed.defaultRun.maxBackoffMs),
        maxErrors: optionalBundleNumber(parsed.defaultRun.maxErrors),
        heartbeatTtlSeconds: optionalBundleNumber(parsed.defaultRun.heartbeatTtlSeconds),
      }
    : undefined;
  return {
    kind: "soloclaw.room_invite",
    version: 1,
    controlUrl,
    controlToken: typeof parsed.controlToken === "string" && parsed.controlToken.trim().length > 0 ? parsed.controlToken : undefined,
    roomId,
    inviteToken,
    inviteId: typeof parsed.inviteId === "string" ? parsed.inviteId : undefined,
    inviteSignatureStatus: typeof parsed.inviteSignatureStatus === "string" ? parsed.inviteSignatureStatus : undefined,
    role: typeof parsed.role === "string" ? parseRoomRole(parsed.role) : undefined,
    aliases,
    displayName: typeof parsed.displayName === "string" && parsed.displayName.trim().length > 0 ? parsed.displayName : undefined,
    expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
    maxUses: optionalBundleNumber(parsed.maxUses),
    sensitivity: typeof parsed.sensitivity === "string" ? parsed.sensitivity : undefined,
    defaultRun,
  };
}

function requiredBundleString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invite bundle is missing ${field}.`);
  }
  return value;
}

function optionalBundleNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type RemoteRunnerStatus = {
  kind: "soloclaw.remote_room_runner_status";
  version: 1;
  updatedAt: string;
  roomId: string;
  agentId: string;
  machineId?: string;
  status: "joined" | "starting" | "running" | "idle" | "error" | "stopped";
  stopReason?: string;
  cycles?: number;
  idleCycles?: number;
  messagesProcessed: number;
  lastPollStopReason?: string;
  lastAckMessageId?: string;
  lastAckSigned?: boolean;
  lastHeartbeat?: {
    agentId: string;
    machineId: string;
    status?: AgentHeartbeatStatus;
    lastHeartbeatAt?: string;
    heartbeatExpiresAt?: string;
    lastRoomId?: string;
    lastError?: string;
  };
  lifecycle?: DaemonLifecycleSnapshot;
  errorCount: number;
  lastError?: string;
};

type LocalAgentServiceManager = "windows_task" | "systemd_user" | "launchd_user" | "termux_service" | "foreground";
type LocalAgentRunbookStepStatus = "required" | "recommended" | "optional" | "blocked";

type LocalAgentRunbookStep = {
  id: string;
  label: string;
  status: LocalAgentRunbookStepStatus;
  command?: string;
  reason: string;
};

type RemoteRoomServicePlan = {
  kind: "soloclaw.remote_room_service_plan";
  version: 1;
  generatedAt: string;
  workspace: string;
  controlUrl: string;
  roomId: string;
  platform: NodeJS.Platform;
  serviceName: "soloclaw-remote-room-agent";
  manager: {
    kind: LocalAgentServiceManager;
    label: string;
    supported: boolean;
  };
  ready: boolean;
  blocked: boolean;
  entrypoint: {
    foregroundCommand: string;
    tokenSource: "AGENT_CONTROL_TOKEN";
  };
  health: {
    statusFile: string;
    stopFile: string;
    statusCommand: string;
    healthCommand: string;
  };
  supervision: {
    installState: "plan_only";
    restartPolicy: "supervisor_managed";
    stopPolicy: string;
    note: string;
  };
  nextCommand: string;
  steps: LocalAgentRunbookStep[];
};

function buildRemoteRoomServicePlan(input: {
  workspace: string;
  controlUrl: string;
  roomId: string;
  options: RemoteCliOptions;
}): RemoteRoomServicePlan {
  const statusFile = input.options.statusFilePath ?? ".agent/tmp/remote-room-status.json";
  const stopFile = input.options.stopFilePath ?? ".agent/tmp/remote-room.stop";
  assertPathInsideWorkspace(input.workspace, statusFile, "--status-file");
  assertPathInsideWorkspace(input.workspace, stopFile, "--stop-file");

  const maxCycles = input.options.maxCycles ?? 10;
  const limit = input.options.limit ?? 10;
  const idleLimit = input.options.maxIdlePolls ?? 1;
  const intervalMs = input.options.idleIntervalMs ?? 1000;
  const loopIntervalMs = input.options.loopIntervalMs ?? 1000;
  const idleCycles = input.options.maxIdleCycles ?? 1;
  const backoffMs = input.options.baseBackoffMs ?? 1000;
  const maxBackoffMs = input.options.maxBackoffMs ?? 30000;
  const maxErrors = input.options.maxErrors ?? 3;
  const heartbeatTtl = input.options.heartbeatTtlSeconds ?? 60;
  const foregroundCommand = [
    "agent remote run",
    `--control-url ${input.controlUrl}`,
    "--control-token <control-token>",
    `--room ${input.roomId}`,
    `--cycles ${maxCycles}`,
    `--limit ${limit}`,
    `--idle-limit ${idleLimit}`,
    `--interval-ms ${intervalMs}`,
    `--loop-interval-ms ${loopIntervalMs}`,
    input.options.stopWhenIdle ? "--stop-when-idle" : undefined,
    `--idle-cycles ${idleCycles}`,
    `--backoff-ms ${backoffMs}`,
    `--max-backoff-ms ${maxBackoffMs}`,
    `--max-errors ${maxErrors}`,
    `--heartbeat-ttl ${heartbeatTtl}`,
    `--status-file ${statusFile}`,
    `--stop-file ${stopFile}`,
    "--json",
  ].filter(Boolean).join(" ");
  const statusCommand = [
    "agent remote service",
    `--control-url ${input.controlUrl}`,
    `--room ${input.roomId}`,
    `--status-file ${statusFile}`,
    `--stop-file ${stopFile}`,
    "--json",
  ].join(" ");
  const healthCommand = [
    "agent remote heartbeat",
    `--control-url ${input.controlUrl}`,
    "--control-token <control-token>",
    `--room ${input.roomId}`,
    "--status online",
    `--ttl ${heartbeatTtl}`,
    "--json",
  ].join(" ");
  const manager = localAgentServiceManager(process.platform);
  const steps: LocalAgentRunbookStep[] = [
    {
      id: "check-service-plan",
      label: "Check remote service plan",
      status: "required",
      command: statusCommand,
      reason: "Review the workspace-local runner paths and token-safe entrypoint before supervising this remote room agent.",
    },
    {
      id: "run-foreground-loop",
      label: "Run foreground remote room loop",
      status: "recommended",
      command: foregroundCommand,
      reason: "Use the foreground runner as the supervised process until an OS service owns this remote room agent.",
    },
    {
      id: "check-health",
      label: "Submit signed heartbeat",
      status: "recommended",
      command: healthCommand,
      reason: "Refresh signed room health after startup or before routing work to this agent.",
    },
    {
      id: "request-shutdown",
      label: "Request graceful shutdown",
      status: "optional",
      command: `create ${stopFile}`,
      reason: "Create the workspace-local stop marker to ask the foreground runner to stop before claiming more inbox work.",
    },
    {
      id: "wrap-os-supervisor",
      label: "Wrap with OS supervisor",
      status: "blocked",
      reason: `${localAgentServiceManagerLabel(manager)} service installation is still plan-only for Phase 5; use the foreground command for evidence.`,
    },
  ];

  return {
    kind: "soloclaw.remote_room_service_plan",
    version: 1,
    generatedAt: new Date().toISOString(),
    workspace: input.workspace,
    controlUrl: input.controlUrl,
    roomId: input.roomId,
    platform: process.platform,
    serviceName: "soloclaw-remote-room-agent",
    manager: {
      kind: manager,
      label: localAgentServiceManagerLabel(manager),
      supported: manager !== "foreground",
    },
    ready: true,
    blocked: false,
    entrypoint: {
      foregroundCommand,
      tokenSource: "AGENT_CONTROL_TOKEN",
    },
    health: {
      statusFile,
      stopFile,
      statusCommand,
      healthCommand,
    },
    supervision: {
      installState: "plan_only",
      restartPolicy: "supervisor_managed",
      stopPolicy: `create ${stopFile}, then inspect ${statusFile} and agent agents health --json from the control workspace`,
      note: "This plan is metadata-only; it does not register, start, stop, or mutate an OS service and never records the control token.",
    },
    nextCommand: foregroundCommand,
    steps,
  };
}

function printRemoteRoomServicePlan<TPlatform extends RemoteCommandPlatform>(
  deps: RemoteCommandDeps<TPlatform>,
  plan: RemoteRoomServicePlan,
): void {
  deps.writeText("Remote room service plan:");
  deps.writeText(`workspace=${plan.workspace}`);
  deps.writeText(
    `service=${plan.serviceName}\tmanager=${plan.manager.kind}\tplatform=${plan.platform}\t` +
    `ready=${plan.ready}\tblocked=${plan.blocked}`,
  );
  deps.writeText(`room=${plan.roomId}\tcontrolUrl=${plan.controlUrl}`);
  deps.writeText(`entrypoint=${plan.entrypoint.foregroundCommand}`);
  deps.writeText(`tokenSource=${plan.entrypoint.tokenSource}`);
  deps.writeText(`statusFile=${plan.health.statusFile}\tstopFile=${plan.health.stopFile}`);
  deps.writeText(`health=${plan.health.healthCommand}`);
  deps.writeText(`supervision=${plan.supervision.installState}\trestart=${plan.supervision.restartPolicy}`);
  deps.writeText(plan.supervision.note);
  deps.writeText("Steps:");
  for (const step of plan.steps) {
    deps.writeText(`- [${step.status}] ${step.label}${step.command ? `: ${step.command}` : ""}`);
    deps.writeText(`  ${step.reason}`);
  }
}

function createRemoteRunnerStatusReporter(input: {
  cwd: string;
  statusFilePath: string;
  roomId: string;
  agentId: string;
  machineId?: string;
}) {
  const state: Omit<RemoteRunnerStatus, "kind" | "version" | "updatedAt"> = {
    roomId: input.roomId,
    agentId: input.agentId,
    machineId: input.machineId,
    status: "starting",
    messagesProcessed: 0,
    errorCount: 0,
  };

  const write = async (patch: Partial<Omit<RemoteRunnerStatus, "kind" | "version" | "updatedAt" | "roomId" | "agentId" | "machineId">>) => {
    Object.assign(state, patch);
    await writeJsonOutputInsideWorkspace(input.cwd, input.statusFilePath, {
      kind: "soloclaw.remote_room_runner_status",
      version: 1,
      updatedAt: new Date().toISOString(),
      ...state,
    } satisfies RemoteRunnerStatus, "--status-file");
  };

  return {
    write,
    async recordPoll(poll: RemoteRoomPollResult) {
      const lastAck = poll.acknowledgements.at(-1);
      await write({
        status: poll.messagesProcessed > 0 ? "running" : "idle",
        messagesProcessed: state.messagesProcessed + poll.messagesProcessed,
        lastPollStopReason: poll.stopReason,
        lastAckMessageId: lastAck?.messageId ?? state.lastAckMessageId,
        lastAckSigned: lastAck ? Boolean(lastAck.ackSignature) : state.lastAckSigned,
        errorCount: state.errorCount,
      });
    },
    async recordError(error: Error, cycle: number) {
      await write({
        status: "error",
        cycles: cycle,
        errorCount: state.errorCount + 1,
        lastError: error.message,
      });
    },
    async recordStop(result: RemoteRoomRunResult) {
      const lastAck = result.acknowledgements.at(-1);
      await write({
        status: "stopped",
        stopReason: result.stopReason,
        cycles: result.cycles,
        idleCycles: result.idleCycles,
        messagesProcessed: result.messagesProcessed,
        lastPollStopReason: result.polls.at(-1)?.stopReason ?? state.lastPollStopReason,
        lastAckMessageId: lastAck?.messageId ?? state.lastAckMessageId,
        lastAckSigned: lastAck ? Boolean(lastAck.ackSignature) : state.lastAckSigned,
        lastHeartbeat: result.lastHeartbeat ?? state.lastHeartbeat,
        lifecycle: result.lifecycle,
        errorCount: result.errors.length,
        lastError: result.errors.at(-1)?.message ?? state.lastError,
      });
    },
  };
}

function createRemoteRunnerStopFileLifecycle(cwd: string, stopFilePath: string): {
  lifecycle: DaemonLifecycleController;
  requestShutdownIfStopFilePresent: () => Promise<void>;
} {
  const resolved = path.resolve(cwd, stopFilePath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("--stop-file must stay inside the current workspace.");
  }

  const lifecycle = new DaemonLifecycleController("remote-room-runner");
  return {
    lifecycle,
    async requestShutdownIfStopFilePresent() {
      if (lifecycle.isShutdownRequested) {
        return;
      }
      try {
        await fs.stat(resolved);
      } catch (error) {
        const code = nodeErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
          return;
        }
        throw error;
      }
      await lifecycle.requestShutdown("stop-file");
    },
  };
}

async function writeJsonOutputInsideWorkspace(cwd: string, outputPath: string, value: unknown, optionName = "--output"): Promise<{ path: string; bytes: number }> {
  const resolved = assertPathInsideWorkspace(cwd, outputPath, optionName);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
  return { path: resolved, bytes: Buffer.byteLength(content, "utf8") };
}

function assertPathInsideWorkspace(cwd: string, inputPath: string, optionName: string): string {
  const resolved = path.resolve(cwd, inputPath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${optionName} must stay inside the current workspace.`);
  }
  return resolved;
}

function localAgentServiceManager(platform: NodeJS.Platform): LocalAgentServiceManager {
  if (platform === "win32") {
    return "windows_task";
  }
  if (platform === "linux") {
    return "systemd_user";
  }
  if (platform === "darwin") {
    return "launchd_user";
  }
  if (platform === "android") {
    return "termux_service";
  }
  return "foreground";
}

function localAgentServiceManagerLabel(manager: LocalAgentServiceManager): string {
  switch (manager) {
    case "windows_task":
      return "Windows Task Scheduler";
    case "systemd_user":
      return "systemd user service";
    case "launchd_user":
      return "launchd user agent";
    case "termux_service":
      return "Termux service";
    case "foreground":
      return "foreground supervisor";
  }
}

type RemoteCliOptions = {
  controlUrl?: string;
  controlToken?: string;
  inviteBundlePath?: string;
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
  replyTemplate?: string;
  statusFilePath?: string;
  stopFilePath?: string;
  runAfterJoin?: boolean;
  includeDelivered?: boolean;
  kind?: RoomMessageKind;
  json?: boolean;
};

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
    if ((arg === "--invite-bundle" || arg === "--bundle") && next) {
      options.inviteBundlePath = next;
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
    if (arg === "--kind" && next) {
      options.kind = parseRoomMessageKind(next);
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
    if (arg === "--reply-template" && next) {
      options.replyTemplate = next;
      index += 1;
      continue;
    }
    if (arg === "--status-file" && next) {
      options.statusFilePath = next;
      index += 1;
      continue;
    }
    if (arg === "--stop-file" && next) {
      options.stopFilePath = next;
      index += 1;
      continue;
    }
    if (arg === "--run") {
      options.runAfterJoin = true;
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

function parseRoomMessageKind(value: string): RoomMessageKind {
  if (
    value === "chat" ||
    value === "task" ||
    value === "decision" ||
    value === "tool_request" ||
    value === "approval" ||
    value === "artifact" ||
    value === "system"
  ) {
    return value;
  }
  throw new Error(`Invalid room message kind: ${value}.`);
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
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

function nodeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readUtf8(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }
  return bytes.toString("utf8");
}

function decodeUtf16Be(bytes: Buffer): string {
  const evenLength = bytes.length - (bytes.length % 2);
  const swapped = Buffer.alloc(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped.toString("utf16le");
}
