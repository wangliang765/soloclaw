import type { CommandModule } from "../command-router.js";
import type {
  ActorRef,
  ExecutionMode,
  KnowledgeSourceKind,
  KnowledgeTrustLevel,
  McpServerRegistration,
  MemoryScope,
  PolicyAction,
  TaskRisk,
} from "../../domain/index.js";
import { parseMcpCapabilities } from "../../mcp/local-mcp-registry.js";
import { pluginToolName } from "../../plugins/local-plugin-loader.js";
import type { RegisteredTool } from "../../protocol/types.js";
import type { KnowledgeEvalCase, KnowledgeEvalThresholds, KnowledgeSafetyMode } from "../../knowledge/knowledge-service.js";

export type ToolCommandStore = {
  close?(): void;
};

export type ToolCommandParsed<TOptions> = {
  task: string;
  options: TOptions;
};

export type ToolCommandTool = {
  name: string;
  handler(input: Record<string, unknown>): Promise<unknown>;
};

export type ToolCommandDeps<TOptions, TPlatform extends { store: ToolCommandStore }, TParsed extends ToolCommandParsed<TOptions>> = {
  cwd(): string;
  parseRunArgs(args: string[]): TParsed;
  createPlatform(cwd: string, options: TOptions): Promise<TPlatform>;
  createTools(platform: TPlatform, parsed: TParsed): Promise<ToolCommandTool[]>;
  parseToolInput(toolName: string, text: string, inputFile?: string): Promise<Record<string, unknown>>;
  inputFile(options: TOptions): string | undefined;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type AgentCommandTemplate = {
  name: string;
  template: string;
  description?: string;
  agentProfile?: string;
  model?: string;
  sourcePath?: string;
};

export type AgentCommandRunResult = {
  finalAnswer: string;
  session?: { id: string };
};

export type AgentCommandStore = ToolCommandStore & {
  recordAuditEvent(event: {
    id: string;
    type: "agent.command_template_executed";
    actor: { type: "user"; id: string; displayName: string };
    sessionId: string;
    summary: string;
    metadata: {
      command: string;
      sourcePath?: string;
      agentProfile?: string;
      argumentCount: number;
    };
    artifactRefs: string[];
    createdAt: string;
  }): Promise<void>;
};

export type AgentCommandPlatform = {
  store: AgentCommandStore;
  agent: {
    runWithSession(prompt: string): Promise<AgentCommandRunResult>;
  };
};

export type AgentCommandPlatformOptions = {
  agentProfile?: string;
  model?: string;
  modelProfile?: string;
};

export type AgentCommandServiceLike = {
  expand(input: { template: string; argumentsText: string }): Promise<string>;
};

export type AgentCommandsCommandDeps<TCommand extends AgentCommandTemplate, TPlatform extends AgentCommandPlatform> = {
  cwd(): string;
  resolveWorkspace(cwd: string, args: string[]): Promise<string>;
  stripWorkspaceOption(args: string[]): string[];
  commandDirectory(workspace: string): string;
  loadCommands(directory: string): Promise<TCommand[]>;
  createCommandService(workspace: string): AgentCommandServiceLike;
  defaultModelProfileForWorkspace(workspace: string): Promise<string | undefined>;
  createPlatform(workspace: string, options: AgentCommandPlatformOptions): Promise<TPlatform>;
  makeAuditId(): string;
  now(): Date;
  splitCliWords(value: string): string[];
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export type SkillRecordLike = {
  manifest: {
    name: string;
    version: string;
    description: string;
  };
  scope: string;
};

export type SkillsStore<TSkill extends SkillRecordLike> = ToolCommandStore & {
  listSkills(): Promise<TSkill[]>;
  getSkill(name: string): Promise<unknown | undefined>;
};

export type SkillsPlatform<TSkill extends SkillRecordLike, TStore extends SkillsStore<TSkill>> = {
  skills: {
    loadDirectory(directory: string): Promise<TSkill[]>;
  };
  store: TStore;
};

export type SkillsCommandDeps<TSkill extends SkillRecordLike, TStore extends SkillsStore<TSkill>> = {
  cwd(): string;
  skillsDirectory(cwd: string): string;
  createPlatform(cwd: string): Promise<SkillsPlatform<TSkill, TStore>>;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

type TextOutputDeps = {
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

type ClosableStore = ToolCommandStore;

export type KnowledgeCommandPlatform = {
  knowledge: {
    ingestText(input: Record<string, unknown>): Promise<{
      source: { id: string; scopeType: string; scopeId: string; name: string };
      chunks: unknown[];
    }>;
    listSources(input: Record<string, unknown>): Promise<Array<{
      id: string;
      kind: string;
      trustLevel: string;
      scopeType: string;
      scopeId: string;
      updatedAt: string;
      name: string;
    }>>;
    search(input: Record<string, unknown>): Promise<Array<{
      citationId: string;
      source?: { id: string; name: string };
      chunk: { sourceId: string; ordinal: number };
      score: number;
      safetyFindings: Array<{ severity: string; rule: string }>;
      snippet: string;
    }>>;
    createEvalSet(input: Record<string, unknown>): Promise<{
      id: string;
      cases: unknown[];
      scopeType?: string;
      scopeId?: string;
      name: string;
    }>;
    listEvalSets(input: Record<string, unknown>): Promise<Array<{
      id: string;
      cases: unknown[];
      scopeType?: string;
      scopeId?: string;
      updatedAt: string;
      name: string;
    }>>;
    listEvalRuns(input: Record<string, unknown>): Promise<Array<{
      id: string;
      evalSetId?: string;
      gate: { passed: boolean };
      metrics: { recallAtK: number; mrr: number };
      createdAt: string;
    }>>;
    summarizeEvalTrend(input: Record<string, unknown>): Promise<KnowledgeEvalTrendView>;
    evaluate(input: Record<string, unknown>): Promise<KnowledgeEvalResultView>;
  };
  store: ClosableStore;
};

export type KnowledgeCommandDeps<TPlatform extends KnowledgeCommandPlatform> = TextOutputDeps & {
  cwd(): string;
  createPlatform(cwd: string): Promise<TPlatform>;
  actor(): ActorRef;
  readUtf8(filePath: string): Promise<string>;
};

type KnowledgeEvalResultView = {
  caseCount: number;
  limit: number;
  metrics: {
    recallAtK: number;
    mrr: number;
    emptyResultRate: number;
    citationPrecision: number;
    permissionLeakRate: number;
    permissionLeakCount: number;
  };
  gate: {
    passed: boolean;
    failures: string[];
  };
  artifact?: { id: string; sha256?: string };
  run?: { id: string; evalSetId?: string };
  cases: Array<{
    id: string;
    hitRank?: number;
    reciprocalRank: number;
    citationPrecision: number;
    permissionLeakCount: number;
    query: string;
  }>;
};

type KnowledgeEvalTrendView = {
  runCount: number;
  passRate: number;
  passCount: number;
  failCount: number;
  regression: { detected: boolean; reasons: string[] };
  latest?: {
    id: string;
    metrics: KnowledgeEvalResultView["metrics"];
    gate: { passed: boolean };
  };
  deltas?: KnowledgeEvalResultView["metrics"];
  artifact?: { id: string; sha256?: string };
};

export type PluginsCommandPlatform = {
  plugins: {
    listPlugins(): Promise<LoadedPluginLike[]>;
    createTools(input: Record<string, unknown>): Promise<RegisteredTool[]>;
  };
  policy: unknown;
  store: ClosableStore;
};

type LoadedPluginLike = {
  id: string;
  rootDir: string;
  manifestPath: string;
  manifest: {
    name: string;
    version: string;
    permissions?: string[];
    commands?: Array<{
      name: string;
      risk?: string;
    }>;
  };
};

export type PluginsCommandDeps<TOptions, TParsed extends ToolCommandParsed<TOptions>, TPlatform extends PluginsCommandPlatform> = TextOutputDeps & {
  cwd(): string;
  parseRunArgs(args: string[]): TParsed;
  createPlatform(cwd: string, options?: TOptions): Promise<TPlatform>;
  withPolicy(tools: RegisteredTool[], options: Record<string, unknown>): RegisteredTool[] | Promise<RegisteredTool[]>;
  actor(): ActorRef;
};

type McpRegistryLike = {
  filePath: string;
  list(): Promise<McpServerView[]>;
  get(id: string): Promise<McpServerView | undefined>;
  register(input: unknown): Promise<McpServerView>;
  remove(id: string): Promise<boolean>;
};

type McpServerView = Pick<McpServerRegistration, "id" | "name" | "policy" | "transport" | "envVarNames" | "capabilities"> & {
  command?: string;
  url?: string;
};

type McpCommandStore = ClosableStore & {
  recordAuditEvent(event: {
    id: string;
    type: "mcp.server_registered" | "mcp.server_removed";
    actor: ActorRef;
    summary: string;
    metadata: Record<string, unknown>;
    artifactRefs: string[];
    createdAt: string;
  }): Promise<void>;
};

export type McpCommandPlatform = {
  store: McpCommandStore;
  locks?: ClosableStore;
  policy?: unknown;
  redactor?: unknown;
  secretBroker?: unknown;
};

type McpConnectionPlanView = {
  server: McpServerView;
  status: "allow" | "ask" | "deny";
  reason: string;
  connection: {
    transport: "stdio" | "http";
    command?: string;
    url?: string;
    envVarNames: string[];
  };
  scope: {
    projectId?: string;
    roomId?: string;
  };
};

type McpExecutionResultView = {
  plan: { server: McpServerView };
  operation: string;
  capabilities?: {
    tools: Array<{ name: string }>;
    resources: Array<{ uri: string }>;
  };
  tool?: {
    ok: boolean;
    output?: string;
    error?: { code: string; message: string };
  };
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: unknown;
  };
};

type McpHealthResultView = {
  serverId: string;
  status: string;
  transport?: string;
  capabilities?: {
    tools?: number;
    resources?: number;
  };
  reason?: string;
  plan?: {
    reason?: string;
  };
};

export type McpCommandDeps<TPlatform extends McpCommandPlatform, TRegistry extends McpRegistryLike> = TextOutputDeps & {
  cwd(): string;
  createPlatform(cwd: string): Promise<TPlatform>;
  createRegistry(cwd: string): TRegistry;
  createConnectionPlanner(registry: TRegistry, platform: TPlatform): {
    plan(input: Record<string, unknown>): Promise<McpConnectionPlanView>;
  };
  createExecutionService(registry: TRegistry, platform: TPlatform): {
    execute(input: Record<string, unknown>): Promise<McpExecutionResultView>;
  };
  createHealthService(registry: TRegistry, platform: TPlatform): {
    check(input: Record<string, unknown>): Promise<McpHealthResultView>;
  };
  actor(): ActorRef;
  makeAuditId(): string;
  now(): Date;
  readUtf8(filePath: string): Promise<string>;
};

export function createSkillsCommand<TSkill extends SkillRecordLike, TStore extends SkillsStore<TSkill>>(
  deps: SkillsCommandDeps<TSkill, TStore>,
): CommandModule<void> {
  return {
    name: "skills",
    summary: "List, load, and show local skills",
    execute: async ({ args }) => {
      const subcommand = args[0] ?? "list";
      let platform: SkillsPlatform<TSkill, TStore> | undefined;
      try {
        platform = await deps.createPlatform(deps.cwd());
        if (subcommand === "load") {
          const loaded = await platform.skills.loadDirectory(deps.skillsDirectory(deps.cwd()));
          for (const skill of loaded) {
            deps.writeText(formatSkillLine(skill));
          }
          return { matched: true };
        }
        if (subcommand === "show") {
          const name = args[1];
          if (!name) {
            deps.writeError("Missing skill name.");
            deps.setExitCode(1);
            return { matched: true };
          }
          const skill = await platform.store.getSkill(name);
          if (!skill) {
            deps.writeError(`Skill not found: ${name}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.writeJson(skill);
          return { matched: true };
        }
        const all = await platform.store.listSkills();
        for (const skill of all) {
          deps.writeText(formatSkillLine(skill));
        }
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createKnowledgeCommand<TPlatform extends KnowledgeCommandPlatform>(
  deps: KnowledgeCommandDeps<TPlatform>,
): CommandModule<void> {
  return {
    name: "knowledge",
    summary: "Ingest, search, and evaluate local knowledge",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "search";
      const args = rawArgs.slice(1);
      const platform = await deps.createPlatform(deps.cwd());
      const actor = deps.actor();
      try {
        if (subcommand === "ingest") {
          const parsed = parseKnowledgeArgs(args);
          const content = parsed.options.inputFile
            ? await deps.readUtf8(parsed.options.inputFile)
            : parsed.positionals.join(" ").trim();
          if (!content) {
            deps.writeError("Usage: agent knowledge ingest [--file path] [--name name] [--scope-type project] [--scope-id local] [--kind manual|file|url|repository|mcp|memory] <text>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await platform.knowledge.ingestText({
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
          deps.writeText(`${result.source.id}\tchunks=${result.chunks.length}\t${result.source.scopeType}:${result.source.scopeId}\t${result.source.name}`);
          return { matched: true };
        }
        if (subcommand === "list") {
          const parsed = parseKnowledgeArgs(args);
          const sources = await platform.knowledge.listSources({
            scopeType: parsed.options.scopeType,
            scopeId: parsed.options.scopeId,
            kind: parsed.options.kind,
            limit: parsed.options.limit,
          });
          for (const source of sources) {
            deps.writeText(`${source.id}\t${source.kind}\t${source.trustLevel}\t${source.scopeType}:${source.scopeId}\t${source.updatedAt}\t${source.name}`);
          }
          return { matched: true };
        }
        if (subcommand === "search") {
          const parsed = parseKnowledgeArgs(args);
          const query = parsed.positionals.join(" ").trim();
          if (!query) {
            deps.writeError("Usage: agent knowledge search [--scope-type project] [--scope-id local] [--limit n] [--enforce-acl] [--safety off|annotate|exclude] <query>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const results = await platform.knowledge.search({
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
            deps.writeText(`${result.citationId}\tsource=${result.source?.id ?? result.chunk.sourceId}\tchunk=${result.chunk.ordinal}\tscore=${result.score.toFixed(2)}\t${result.source?.name ?? "-"}`);
            if (result.safetyFindings.length > 0) {
              deps.writeText(`safety\t${result.safetyFindings.map((finding) => `${finding.severity}:${finding.rule}`).join(",")}`);
            }
            deps.writeText(result.snippet);
          }
          return { matched: true };
        }
        if (subcommand === "eval-set") {
          const action = args[0] ?? "create";
          const parsed = parseKnowledgeArgs(args.slice(1));
          if (action !== "create") {
            deps.writeError("Usage: agent knowledge eval-set create --file eval.json --name name");
            deps.setExitCode(1);
            return { matched: true };
          }
          const input = parsed.options.inputFile
            ? parseKnowledgeEvalFile(await deps.readUtf8(parsed.options.inputFile))
            : parseKnowledgeEvalFile(parsed.positionals.join(" ").trim());
          if (!parsed.options.name || input.cases.length === 0) {
            deps.writeError("Usage: agent knowledge eval-set create --file eval.json --name name");
            deps.setExitCode(1);
            return { matched: true };
          }
          const evalSet = await platform.knowledge.createEvalSet({
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
          deps.writeText(`${evalSet.id}\tcases=${evalSet.cases.length}\t${evalSet.scopeType ?? "-"}:${evalSet.scopeId ?? "-"}\t${evalSet.name}`);
          return { matched: true };
        }
        if (subcommand === "eval-sets") {
          const parsed = parseKnowledgeArgs(args);
          const evalSets = await platform.knowledge.listEvalSets({
            scopeType: parsed.options.scopeType,
            scopeId: parsed.options.scopeId,
            sourceId: parsed.options.sourceId,
            limit: parsed.options.limit,
          });
          for (const evalSet of evalSets) {
            deps.writeText(`${evalSet.id}\tcases=${evalSet.cases.length}\t${evalSet.scopeType ?? "-"}:${evalSet.scopeId ?? "-"}\t${evalSet.updatedAt}\t${evalSet.name}`);
          }
          return { matched: true };
        }
        if (subcommand === "eval-runs") {
          const parsed = parseKnowledgeArgs(args);
          const runs = await platform.knowledge.listEvalRuns({
            evalSetId: parsed.options.evalSetId,
            scopeType: parsed.options.scopeType,
            scopeId: parsed.options.scopeId,
            sourceId: parsed.options.sourceId,
            limit: parsed.options.limit,
          });
          for (const run of runs) {
            deps.writeText(`${run.id}\tset=${run.evalSetId ?? "-"}\tgate=${run.gate.passed ? "passed" : "failed"}\trecall=${run.metrics.recallAtK.toFixed(3)}\tmrr=${run.metrics.mrr.toFixed(3)}\tcreated=${run.createdAt}`);
          }
          return { matched: true };
        }
        if (subcommand === "eval-trend") {
          const parsed = parseKnowledgeArgs(args);
          const trend = await platform.knowledge.summarizeEvalTrend({
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
            deps.writeJson(trend);
            if (trend.regression.detected) {
              deps.setExitCode(2);
            }
            return { matched: true };
          }
          deps.writeText(`runs=${trend.runCount}\tpassRate=${trend.passRate.toFixed(3)}\tpass=${trend.passCount}\tfail=${trend.failCount}\tregression=${trend.regression.detected ? "yes" : "no"}`);
          if (trend.latest) {
            deps.writeText(`latest\t${trend.latest.id}\trecall=${trend.latest.metrics.recallAtK.toFixed(3)}\tmrr=${trend.latest.metrics.mrr.toFixed(3)}\tempty=${trend.latest.metrics.emptyResultRate.toFixed(3)}\tcitation_precision=${trend.latest.metrics.citationPrecision.toFixed(3)}\tpermission_leak_rate=${trend.latest.metrics.permissionLeakRate.toFixed(3)}\tpermission_leak_count=${trend.latest.metrics.permissionLeakCount}\tgate=${trend.latest.gate.passed ? "passed" : "failed"}`);
          }
          if (trend.deltas) {
            deps.writeText(`delta\trecall=${trend.deltas.recallAtK.toFixed(3)}\tmrr=${trend.deltas.mrr.toFixed(3)}\tempty=${trend.deltas.emptyResultRate.toFixed(3)}\tcitation_precision=${trend.deltas.citationPrecision.toFixed(3)}\tpermission_leak_rate=${trend.deltas.permissionLeakRate.toFixed(3)}\tpermission_leak_count=${trend.deltas.permissionLeakCount}`);
          }
          for (const reason of trend.regression.reasons) {
            deps.writeText(`regression_reason\t${reason}`);
          }
          if (trend.artifact) {
            deps.writeText(`artifact\t${trend.artifact.id}\tsha256=${trend.artifact.sha256}`);
          }
          if (trend.regression.detected) {
            deps.setExitCode(2);
          }
          return { matched: true };
        }
        if (subcommand === "eval") {
          const parsed = parseKnowledgeArgs(args);
          const input = parsed.options.inputFile || parsed.positionals.length > 0
            ? parseKnowledgeEvalFile(parsed.options.inputFile ? await deps.readUtf8(parsed.options.inputFile) : parsed.positionals.join(" ").trim())
            : { cases: [] };
          if (input.cases.length === 0 && !parsed.options.evalSetId) {
            deps.writeError("Usage: agent knowledge eval --file eval.json|--eval-set id [--scope-type project] [--scope-id local] [--limit n] [--min-recall n] [--min-mrr n] [--max-empty-rate n] [--min-citation-precision n] [--max-permission-leak-rate n] [--enforce-acl] [--safety off|annotate|exclude] [--save-run] [--save-artifact] [--artifact-name name] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await platform.knowledge.evaluate({
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
            deps.writeJson(result);
            if (!result.gate.passed) {
              deps.setExitCode(2);
            }
            return { matched: true };
          }
          deps.writeText(`cases=${result.caseCount}\tlimit=${result.limit}\trecall@${result.limit}=${result.metrics.recallAtK.toFixed(3)}\tmrr=${result.metrics.mrr.toFixed(3)}\tempty=${result.metrics.emptyResultRate.toFixed(3)}\tcitation_precision=${result.metrics.citationPrecision.toFixed(3)}\tpermission_leak_rate=${result.metrics.permissionLeakRate.toFixed(3)}\tpermission_leak_count=${result.metrics.permissionLeakCount}\tgate=${result.gate.passed ? "passed" : "failed"}`);
          for (const failure of result.gate.failures) {
            deps.writeText(`gate_failure\t${failure}`);
          }
          if (result.artifact) {
            deps.writeText(`artifact\t${result.artifact.id}\tsha256=${result.artifact.sha256}`);
          }
          if (result.run) {
            deps.writeText(`run\t${result.run.id}\tset=${result.run.evalSetId ?? "-"}`);
          }
          for (const item of result.cases) {
            deps.writeText(`${item.id}\thit=${item.hitRank ?? "-"}\trr=${item.reciprocalRank.toFixed(3)}\tcitation_precision=${item.citationPrecision.toFixed(3)}\tpermission_leaks=${item.permissionLeakCount}\t${item.query}`);
          }
          if (!result.gate.passed) {
            deps.setExitCode(2);
          }
          return { matched: true };
        }
        deps.writeError(`Unknown knowledge command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createPluginsCommand<
  TOptions,
  TParsed extends ToolCommandParsed<TOptions>,
  TPlatform extends PluginsCommandPlatform,
>(deps: PluginsCommandDeps<TOptions, TParsed, TPlatform>): CommandModule<void> {
  return {
    name: "plugins",
    summary: "List, show, and run command plugins",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "list";

      if (subcommand === "run") {
        const toolName = rawArgs[1];
        if (!toolName) {
          deps.writeError("Usage: agent plugins run <plugin.tool.name> [--execution-mode strict|balanced|trusted|full_access] [--room room-id] [--input-file file] [json-input]");
          deps.setExitCode(1);
          return { matched: true };
        }
        const parsed = deps.parseRunArgs(rawArgs.slice(2));
        const platform = await deps.createPlatform(deps.cwd(), parsed.options);
        const actor = deps.actor();
        try {
          const tools = await deps.withPolicy(await platform.plugins.createTools({
            store: platform.store,
            actor,
            roomId: optionString(parsed.options, "roomId"),
          }), {
            actor,
            mode: optionString(parsed.options, "executionMode") ?? "trusted",
            risk: "medium",
            policy: platform.policy,
            store: platform.store,
            scope: {
              orgId: optionString(parsed.options, "orgId"),
              projectId: optionString(parsed.options, "projectId"),
              roomId: optionString(parsed.options, "roomId"),
            },
            roomId: optionString(parsed.options, "roomId"),
          });
          const tool = tools.find((candidate) => candidate.name === toolName);
          if (!tool) {
            deps.writeError(`Unknown plugin tool: ${toolName}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.writeJson(await tool.handler(await parsePluginInput(parsed.task, optionString(parsed.options, "inputFile"))));
        } catch (error) {
          deps.writeError(error instanceof Error ? error.message : String(error));
          deps.setExitCode(1);
        } finally {
          platform.store.close?.();
        }
        return { matched: true };
      }

      const platform = await deps.createPlatform(deps.cwd());
      try {
        const loaded = await platform.plugins.listPlugins();
        if (subcommand === "list") {
          for (const plugin of loaded) {
            for (const pluginCommand of plugin.manifest.commands ?? []) {
              deps.writeText(`${pluginToolName(plugin.manifest.name, pluginCommand.name)}\t${plugin.manifest.version}\t${pluginCommand.risk ?? "auto"}\t${(plugin.manifest.permissions ?? []).join(",")}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "show") {
          const name = rawArgs[1];
          if (!name) {
            deps.writeError("Usage: agent plugins show <plugin-name|plugin.tool.name>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const plugin = loaded.find((candidate) => {
            if (candidate.manifest.name === name) {
              return true;
            }
            return (candidate.manifest.commands ?? []).some((pluginCommand) => pluginToolName(candidate.manifest.name, pluginCommand.name) === name);
          });
          if (!plugin) {
            deps.writeError(`Plugin not found: ${name}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.writeJson({
            ...plugin,
            tools: (plugin.manifest.commands ?? []).map((pluginCommand) => pluginToolName(plugin.manifest.name, pluginCommand.name)),
          });
          return { matched: true };
        }
        deps.writeError(`Unknown plugins command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createMcpCommand<TPlatform extends McpCommandPlatform, TRegistry extends McpRegistryLike>(
  deps: McpCommandDeps<TPlatform, TRegistry>,
): CommandModule<void> {
  return {
    name: "mcp",
    summary: "Manage and call local MCP servers",
    execute: async ({ args: rawArgs }) => {
      const subcommand = rawArgs[0] ?? "list";
      const args = rawArgs.slice(1);
      const platform = await deps.createPlatform(deps.cwd());
      const registry = deps.createRegistry(deps.cwd());
      const actor = deps.actor();
      try {
        if (subcommand === "list") {
          const parsed = parseMcpArgs(args);
          const servers = await registry.list();
          if (parsed.options.json) {
            deps.writeJson({ servers, configPath: registry.filePath });
            return { matched: true };
          }
          for (const server of servers) {
            deps.writeText(formatMcpServer(server));
          }
          return { matched: true };
        }
        if (subcommand === "show") {
          const id = args[0];
          if (!id) {
            deps.writeError("Usage: agent mcp show <server-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const server = await registry.get(id);
          if (!server) {
            deps.writeError(`MCP server not found: ${id}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.writeJson(server);
          return { matched: true };
        }
        if (subcommand === "plan" || subcommand === "plan-connection") {
          const parsed = parseMcpArgs(args);
          const id = parsed.positionals[0];
          if (!id) {
            deps.writeError("Usage: agent mcp plan <server-id> [--execution-mode strict|balanced|trusted|full_access] [--project id] [--room id] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const plan = await deps.createConnectionPlanner(registry, platform).plan({
            serverId: id,
            actor,
            mode: parsed.options.executionMode ?? "trusted",
            scope: {
              projectId: parsed.options.scopeProjectId,
              roomId: parsed.options.scopeRoomId,
            },
          });
          if (parsed.options.json) {
            deps.writeJson(plan);
          } else {
            deps.writeText(formatMcpConnectionPlan(plan));
          }
          if (plan.status === "deny") {
            deps.setExitCode(1);
          }
          return { matched: true };
        }
        if (subcommand === "capabilities" || subcommand === "list-capabilities") {
          const parsed = parseMcpArgs(args);
          const id = parsed.positionals[0];
          if (!id) {
            deps.writeError("Usage: agent mcp capabilities <server-id> [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await deps.createExecutionService(registry, platform).execute({
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
            deps.writeJson(result);
          } else {
            deps.writeText(formatMcpExecutionResult(result));
          }
          return { matched: true };
        }
        if (subcommand === "health" || subcommand === "diagnose") {
          const parsed = parseMcpArgs(args);
          const id = parsed.positionals[0];
          if (!id) {
            deps.writeError("Usage: agent mcp health <server-id> [--execution-mode trusted|full_access] [--project id] [--room id] [--timeout-ms n] [--secret-env NAME=sec_xxxxxxxx] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await deps.createHealthService(registry, platform).check({
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
            deps.writeJson(result);
          } else {
            deps.writeText(formatMcpHealthResult(result));
          }
          if (result.status !== "healthy") {
            deps.setExitCode(2);
          }
          return { matched: true };
        }
        if (subcommand === "call-tool") {
          const parsed = parseMcpArgs(args);
          const id = parsed.positionals[0];
          const toolName = parsed.positionals[1];
          if (!id || !toolName) {
            deps.writeError("Usage: agent mcp call-tool <server-id> <tool-name> [--input-json '{...}'|--input-file file.json] [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const input = await readJsonObjectInput(deps, parsed.options.inputJson, parsed.options.inputFile);
          const result = await deps.createExecutionService(registry, platform).execute({
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
            deps.writeJson(result);
          } else {
            deps.writeText(formatMcpExecutionResult(result));
          }
          if (result.tool && !result.tool.ok) {
            deps.setExitCode(2);
          }
          return { matched: true };
        }
        if (subcommand === "read-resource") {
          const parsed = parseMcpArgs(args);
          const id = parsed.positionals[0];
          const uri = parsed.positionals[1];
          if (!id || !uri) {
            deps.writeError("Usage: agent mcp read-resource <server-id> <uri> [--execution-mode trusted|full_access] [--project id] [--room id] [--secret-env NAME=sec_xxxxxxxx] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await deps.createExecutionService(registry, platform).execute({
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
            deps.writeJson(result);
          } else {
            deps.writeText(formatMcpExecutionResult(result));
          }
          return { matched: true };
        }
        if (subcommand === "register") {
          const parsed = parseMcpArgs(args);
          const id = parsed.positionals[0];
          if (!id || !parsed.options.transport) {
            deps.writeError("Usage: agent mcp register <server-id> --transport stdio|http [--name name] [--command cmd|--url url] [--arg value] [--env-var NAME] [--cap tools|resources|prompts|sampling] [--risk low|medium|high|critical] [--no-approval] [--disabled] [--project id] [--room id]");
            deps.setExitCode(1);
            return { matched: true };
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
            id: deps.makeAuditId(),
            type: "mcp.server_registered",
            actor,
            summary: "MCP server registered locally",
            metadata: safeMcpAuditMetadata(server),
            artifactRefs: [],
            createdAt: deps.now().toISOString(),
          });
          deps.writeText(formatMcpServer(server));
          return { matched: true };
        }
        if (subcommand === "remove" || subcommand === "delete") {
          const id = args[0];
          if (!id) {
            deps.writeError("Usage: agent mcp remove <server-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const existing = await registry.get(id);
          const removed = await registry.remove(id);
          if (removed && existing) {
            await platform.store.recordAuditEvent({
              id: deps.makeAuditId(),
              type: "mcp.server_removed",
              actor,
              summary: "MCP server removed locally",
              metadata: safeMcpAuditMetadata(existing),
              artifactRefs: [],
              createdAt: deps.now().toISOString(),
            });
          }
          deps.writeText(removed ? `removed\t${id}` : `not-found\t${id}`);
          return { matched: true };
        }
        deps.writeError(`Unknown mcp command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.locks?.close?.();
        platform.store.close?.();
      }
      return { matched: true };
    },
  };
}

export function createAgentCommandsCommand<TCommand extends AgentCommandTemplate, TPlatform extends AgentCommandPlatform>(
  deps: AgentCommandsCommandDeps<TCommand, TPlatform>,
): CommandModule<void> {
  return {
    name: "commands",
    summary: "List, show, and run local command templates",
    execute: async ({ args }) => {
      const subcommand = args[0] ?? "list";
      const commandArgs = args.slice(1);
      try {
        const workspace = await deps.resolveWorkspace(deps.cwd(), commandArgs);
        const cleanCommandArgs = deps.stripWorkspaceOption(commandArgs);
        const commands = await deps.loadCommands(deps.commandDirectory(workspace));

        if (subcommand === "list") {
          for (const item of commands) {
            deps.writeText(`${item.name}\t${item.agentProfile ?? "-"}\t${item.description ?? ""}`);
          }
          return { matched: true };
        }
        if (subcommand === "show") {
          const name = cleanCommandArgs[0];
          const item = commands.find((candidate) => candidate.name === name);
          if (!name || !item) {
            deps.writeError(name ? `Command not found: ${name}` : "Missing command name.");
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.writeJson(item);
          return { matched: true };
        }
        if (subcommand === "run") {
          const name = cleanCommandArgs[0];
          const item = commands.find((candidate) => candidate.name === name);
          if (!name || !item) {
            deps.writeError(name ? `Command not found: ${name}` : "Missing command name.");
            deps.setExitCode(1);
            return { matched: true };
          }
          const argumentsText = cleanCommandArgs.slice(1).join(" ");
          let expanded: string;
          try {
            expanded = await deps.createCommandService(workspace).expand({ template: item.template, argumentsText });
          } catch (error) {
            deps.writeError(error instanceof Error ? error.message : String(error));
            deps.setExitCode(1);
            return { matched: true };
          }
          const platformOptions: AgentCommandPlatformOptions = {
            agentProfile: item.agentProfile,
            model: item.model,
          };
          platformOptions.modelProfile = await deps.defaultModelProfileForWorkspace(workspace);
          const platform = await deps.createPlatform(workspace, platformOptions);
          try {
            const result = await platform.agent.runWithSession(expanded);
            if (result.session) {
              await platform.store.recordAuditEvent({
                id: deps.makeAuditId(),
                type: "agent.command_template_executed",
                actor: { type: "user", id: "local-user", displayName: "Local User" },
                sessionId: result.session.id,
                summary: `Agent command executed: ${item.name}`,
                metadata: {
                  command: item.name,
                  sourcePath: item.sourcePath,
                  agentProfile: item.agentProfile,
                  argumentCount: deps.splitCliWords(argumentsText).length,
                },
                artifactRefs: [],
                createdAt: deps.now().toISOString(),
              });
            }
            deps.writeText(result.finalAnswer);
            if (result.session) {
              deps.writeText("");
              deps.writeText(`session: ${result.session.id}`);
            }
          } finally {
            platform.store.close?.();
          }
          return { matched: true };
        }
        deps.writeError(`Unknown commands subcommand: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

function formatSkillLine(skill: SkillRecordLike): string {
  return `${skill.manifest.name}@${skill.manifest.version}\t${skill.scope}\t${skill.manifest.description}`;
}

export function createToolCommand<
  TOptions,
  TPlatform extends { store: ToolCommandStore },
  TParsed extends ToolCommandParsed<TOptions>,
>(deps: ToolCommandDeps<TOptions, TPlatform, TParsed>): CommandModule<void> {
  return {
    name: "tool",
    summary: "Run a workspace tool through policy",
    execute: async ({ args }) => {
      const [toolName, ...toolArgs] = args;
      if (!toolName) {
        deps.writeError("Missing tool name.");
        deps.setExitCode(1);
        return { matched: true };
      }

      let platform: TPlatform | undefined;
      try {
        const parsed = deps.parseRunArgs(toolArgs);
        platform = await deps.createPlatform(deps.cwd(), parsed.options);
        const tools = await deps.createTools(platform, parsed);
        const tool = tools.find((candidate) => candidate.name === toolName);
        if (!tool) {
          deps.writeError(`Unknown tool: ${toolName}`);
          deps.setExitCode(1);
          return { matched: true };
        }
        const input = await deps.parseToolInput(toolName, parsed.task, deps.inputFile(parsed.options));
        deps.writeJson(await tool.handler(input));
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform?.store.close?.();
      }
      return { matched: true };
    },
  };
}

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

function formatMcpServer(server: McpServerView): string {
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

function formatMcpConnectionPlan(plan: McpConnectionPlanView): string {
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

function formatMcpExecutionResult(result: McpExecutionResultView): string {
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

function formatMcpHealthResult(result: McpHealthResultView): string {
  return [
    result.serverId,
    result.status,
    `transport=${result.transport ?? "-"}`,
    `tools=${result.capabilities?.tools ?? "-"}`,
    `resources=${result.capabilities?.resources ?? "-"}`,
    `reason=${result.reason ?? result.plan?.reason ?? "-"}`,
  ].join("\t");
}

async function readJsonObjectInput(
  deps: { readUtf8(filePath: string): Promise<string> },
  inputJson?: string,
  inputFile?: string,
): Promise<Record<string, unknown>> {
  const raw = inputFile ? await deps.readUtf8(inputFile) : inputJson ?? "{}";
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("MCP tool input must be a JSON object.");
  }
  return parsed;
}

function safeMcpAuditMetadata(server: McpServerView): Record<string, unknown> {
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

export function isMcpApprovalAction(action: PolicyAction): boolean {
  return action === "mcp.connect" || action === "mcp.tool.call" || action === "mcp.resource.read";
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

function parseKnowledgeSafetyMode(value: string): KnowledgeSafetyMode {
  if (value === "off" || value === "annotate" || value === "exclude") {
    return value;
  }
  throw new Error(`Invalid knowledge safety mode: ${value}. Expected off, annotate, or exclude.`);
}

async function parsePluginInput(text: string, inputFile?: string): Promise<Record<string, unknown>> {
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

function optionString(options: unknown, key: string): string | undefined {
  if (!isRecord(options)) {
    return undefined;
  }
  const value = options[key];
  return typeof value === "string" ? value : undefined;
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
