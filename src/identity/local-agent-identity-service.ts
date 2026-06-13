import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { AgentHeartbeatEnvelope, AgentIdentity, AuditExportBundle, MachineId, RoomDeliveryAckEnvelope, RoomInviteEnvelope, RoomMessage, TaskLeaseEnvelope, WorkerHeartbeatEnvelope } from "../domain/index.js";
import { agentHeartbeatEnvelopeSigningPayload, auditExportBundleSigningPayload, roomDeliveryAckEnvelopeSigningPayload, roomInviteEnvelopeSigningPayload, taskLeaseEnvelopeSigningPayload, workerHeartbeatEnvelopeSigningPayload } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { AgentStore } from "../store/agent-store.js";

type IdentityFile = {
  agentId: string;
  machineId: string;
  displayName: string;
  publicKeyPem: string;
  privateKeyPath: string;
  fingerprint: string;
  capabilities: string[];
  createdAt: string;
};

export class LocalAgentIdentityService {
  private readonly identityDir: string;
  private readonly identityPath: string;
  private readonly privateKeyPath: string;

  constructor(
    private readonly cwd: string,
    private readonly store: AgentStore,
  ) {
    this.identityDir = path.join(cwd, ".agent", "identity");
    this.identityPath = path.join(this.identityDir, "local-agent.json");
    this.privateKeyPath = path.join(this.identityDir, "local-agent.private.pem");
  }

  async getOrCreate(displayName = defaultDisplayName()): Promise<AgentIdentity> {
    if (existsSync(this.identityPath) && existsSync(this.privateKeyPath)) {
      const file = JSON.parse(readFileSync(this.identityPath, "utf8")) as IdentityFile;
      const identity = this.fromFile(file, displayName);
      await this.store.registerAgent(identity);
      return identity;
    }

    mkdirSync(this.identityDir, { recursive: true });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = new Date().toISOString();
    const file: IdentityFile = {
      agentId: makeId<"AgentId">("agent"),
      machineId: makeId<"MachineId">("machine"),
      displayName,
      publicKeyPem,
      privateKeyPath: this.privateKeyPath,
      fingerprint: fingerprintPublicKey(publicKeyPem),
      capabilities: defaultCapabilities(),
      createdAt: now,
    };
    writeFileSync(this.privateKeyPath, privateKeyPem, { mode: 0o600 });
    writeFileSync(this.identityPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    const identity = this.fromFile(file, displayName);
    await this.store.registerAgent(identity);
    return identity;
  }

  async show(): Promise<{ identity: AgentIdentity; privateKeyPath: string }> {
    const identity = await this.getOrCreate();
    return { identity, privateKeyPath: this.privateKeyPath };
  }

  async signRoomMessage(message: Omit<RoomMessage, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (message.sender.type !== "agent" || message.sender.id !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(roomMessageSigningPayload(message), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyRoomMessage(message: RoomMessage): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!message.signature) {
      return "unsigned";
    }
    if (message.sender.type !== "agent") {
      return "invalid";
    }
    const agent = await this.store.getAgent(message.sender.id);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = message.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(roomMessageSigningPayload(message), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  async signTaskLeaseEnvelope(envelope: Omit<TaskLeaseEnvelope, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (envelope.claimedBy.type !== "agent" || envelope.claimedBy.id !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(taskLeaseEnvelopeSigningPayload(envelope), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyTaskLeaseEnvelope(envelope: TaskLeaseEnvelope): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!envelope.signature) {
      return "unsigned";
    }
    if (envelope.claimedBy.type !== "agent") {
      return "invalid";
    }
    const agent = await this.store.getAgent(envelope.claimedBy.id);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = envelope.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(taskLeaseEnvelopeSigningPayload(envelope), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  async signWorkerHeartbeatEnvelope(envelope: Omit<WorkerHeartbeatEnvelope, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (envelope.heartbeatBy.type !== "agent" || envelope.heartbeatBy.id !== identity.id || envelope.agentId !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(workerHeartbeatEnvelopeSigningPayload(envelope), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyWorkerHeartbeatEnvelope(envelope: WorkerHeartbeatEnvelope): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!envelope.signature) {
      return "unsigned";
    }
    if (envelope.heartbeatBy.type !== "agent" || envelope.heartbeatBy.id !== envelope.agentId) {
      return "invalid";
    }
    const agent = await this.store.getAgent(envelope.agentId);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = envelope.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(workerHeartbeatEnvelopeSigningPayload(envelope), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  async signAgentHeartbeatEnvelope(envelope: Omit<AgentHeartbeatEnvelope, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (envelope.heartbeatBy.type !== "agent" || envelope.heartbeatBy.id !== identity.id || envelope.agentId !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(agentHeartbeatEnvelopeSigningPayload(envelope), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyAgentHeartbeatEnvelope(envelope: AgentHeartbeatEnvelope): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!envelope.signature) {
      return "unsigned";
    }
    if (envelope.heartbeatBy.type !== "agent" || envelope.heartbeatBy.id !== envelope.agentId) {
      return "invalid";
    }
    const agent = await this.store.getAgent(envelope.agentId);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = envelope.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(agentHeartbeatEnvelopeSigningPayload(envelope), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  async signRoomDeliveryAckEnvelope(envelope: Omit<RoomDeliveryAckEnvelope, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (envelope.acknowledgedBy.type !== "agent" || envelope.acknowledgedBy.id !== identity.id || envelope.agentId !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(roomDeliveryAckEnvelopeSigningPayload(envelope), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyRoomDeliveryAckEnvelope(envelope: RoomDeliveryAckEnvelope): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!envelope.signature) {
      return "unsigned";
    }
    if (envelope.acknowledgedBy.type !== "agent" || envelope.acknowledgedBy.id !== envelope.agentId) {
      return "invalid";
    }
    const agent = await this.store.getAgent(envelope.agentId);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = envelope.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(roomDeliveryAckEnvelopeSigningPayload(envelope), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  async signRoomInviteEnvelope(envelope: Omit<RoomInviteEnvelope, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (envelope.createdBy.type !== "agent" || envelope.createdBy.id !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(roomInviteEnvelopeSigningPayload(envelope), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyRoomInviteEnvelope(envelope: RoomInviteEnvelope): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!envelope.signature) {
      return "unsigned";
    }
    if (envelope.createdBy.type !== "agent") {
      return "invalid";
    }
    const agent = await this.store.getAgent(envelope.createdBy.id);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = envelope.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(roomInviteEnvelopeSigningPayload(envelope), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  async signAuditExportBundle(bundle: Omit<AuditExportBundle, "signature">): Promise<string | undefined> {
    const identity = await this.getOrCreate();
    if (bundle.createdBy.type !== "agent" || bundle.createdBy.id !== identity.id) {
      return undefined;
    }
    const privateKeyPem = readFileSync(this.privateKeyPath, "utf8");
    const signature = sign(null, Buffer.from(auditExportBundleSigningPayload(bundle), "utf8"), createPrivateKey(privateKeyPem));
    return `ed25519:${signature.toString("base64")}`;
  }

  async verifyAuditExportBundle(bundle: AuditExportBundle): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (!bundle.signature) {
      return "unsigned";
    }
    if (bundle.createdBy.type !== "agent") {
      return "invalid";
    }
    const agent = await this.store.getAgent(bundle.createdBy.id);
    if (!agent) {
      return "unknown_agent";
    }
    const [algorithm, encoded] = bundle.signature.split(":", 2);
    if (algorithm !== "ed25519" || !encoded) {
      return "invalid";
    }
    const ok = verify(
      null,
      Buffer.from(auditExportBundleSigningPayload(bundle), "utf8"),
      createPublicKey(agent.publicKeyPem),
      Buffer.from(encoded, "base64"),
    );
    return ok ? "valid" : "invalid";
  }

  private fromFile(file: IdentityFile, displayName: string): AgentIdentity {
    return {
      id: file.agentId as AgentIdentity["id"],
      machineId: file.machineId as MachineId,
      displayName: file.displayName || displayName,
      publicKeyPem: file.publicKeyPem,
      fingerprint: file.fingerprint,
      capabilities: file.capabilities,
      allowedProjects: [],
      trustStatus: "trusted",
      createdAt: file.createdAt,
      lastSeenAt: new Date().toISOString(),
    };
  }
}

export function roomMessageSigningPayload(message: Omit<RoomMessage, "signature">): string {
  return JSON.stringify({
    id: message.id,
    roomId: message.roomId,
    senderType: message.sender.type,
    senderId: message.sender.id,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt,
    parentMessageId: message.parentMessageId ?? null,
    artifactRefs: message.artifactRefs ?? [],
    routing: message.routing ?? null,
    metadata: message.metadata ?? {},
  });
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const digest = createHash("sha256").update(publicKeyPem).digest("hex").toUpperCase();
  return `SHA256:${digest.match(/.{1,4}/g)?.join("-") ?? digest}`;
}

function defaultDisplayName(): string {
  return `local-agent@${os.hostname()}`;
}

function defaultCapabilities(): string[] {
  return [
    "room.message.send",
    "task.delegate",
    "workspace.read",
    "workspace.write",
    "tool.request",
  ];
}
