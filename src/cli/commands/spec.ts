import type { CommandModule } from "../command-router.js";

type ParsedSpecArgs = {
  options: Record<string, any>;
  positionals: string[];
};

type SpecCommandPlatform = {
  specifications: any;
  close(): void;
};

export type SpecCommandDeps = {
  createPlatform(): Promise<SpecCommandPlatform>;
  actor(): unknown;
  parseArgs(args: string[]): ParsedSpecArgs;
  parseSpecificationStatus(value: string): unknown;
  parseSpecificationPlanStatus(value: string, allowed?: string[]): unknown;
  parseSpecificationClarificationStatus(value: string): unknown;
  parseAnswerClarificationStatus(value: string): unknown;
  parseSpecificationTaskStatus(value: string): unknown;
  parseSpecificationVerificationStatus(value: string): unknown;
  parseSpecificationEvidenceProvider(value: string): unknown;
  parseSpecificationEvidenceConclusion(value: string): unknown;
  writeText(text: string): void;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createSpecCommand(deps: SpecCommandDeps): CommandModule<void> {
  return {
    name: "spec",
    summary: "Manage specifications, plans, tasks, and evidence",
    execute: async ({ args: rest }) => {
      const subcommand = rest[0] ?? "list";
      const args = rest.slice(1);
      const platform = await deps.createPlatform();
      const specifications = platform.specifications;
      const actor = deps.actor();
      try {
        if (subcommand === "create") {
          const parsed = deps.parseArgs(args);
          const objective = parsed.positionals.join(" ").trim();
          if (!objective) {
            deps.writeError("Usage: agent spec create [--title title] [--org org-id] [--project project-id] [--room room-id] <objective>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const spec = await specifications.create({
            actor,
            objective,
            title: parsed.options.title,
            orgId: parsed.options.orgId,
            projectId: parsed.options.projectId,
            roomId: parsed.options.roomId,
          });
          deps.writeText(`${spec.id}\t${spec.status}\t${spec.projectId ?? "-"}\t${spec.title}`);
          return { matched: true };
        }
        if (subcommand === "list") {
          const parsed = deps.parseArgs(args);
          const specs = await specifications.list({
            orgId: parsed.options.orgId,
            projectId: parsed.options.projectId,
            roomId: parsed.options.roomId,
            status: parsed.options.status ? deps.parseSpecificationStatus(parsed.options.status) : undefined,
            limit: parsed.options.limit,
          });
          for (const spec of specs) {
            deps.writeText(`${spec.id}\t${spec.status}\t${spec.updatedAt}\tproject=${spec.projectId ?? "-"}\troom=${spec.roomId ?? "-"}\t${spec.title}`);
          }
          return { matched: true };
        }
        if (subcommand === "show") {
          const specId = args[0];
          if (!specId) {
            deps.writeError("Usage: agent spec show <spec-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const spec = await specifications.get(specId);
          if (!spec) {
            deps.writeError(`Specification not found: ${specId}`);
            deps.setExitCode(1);
            return { matched: true };
          }
          deps.writeJson({
            spec,
            tasks: await specifications.listTasks(specId),
            verifications: await specifications.listTaskVerifications({ specId, limit: 500 }),
            versions: await specifications.listVersions(specId, 50),
            clarifications: await specifications.listClarifications({ specId, limit: 100 }),
            plans: await specifications.listPlans({ specId, limit: 50 }),
          });
          return { matched: true };
        }
        if (subcommand === "version") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec version <spec-id> [--reason text] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const version = await specifications.createVersion({
            actor,
            specId,
            reason: parsed.options.reason,
          });
          if (parsed.options.json) {
            deps.writeJson(version);
          } else {
            deps.writeText(`${version.id}\tv${version.version}\ttasks=${version.taskSnapshot.length}\t${version.createdAt}\t${version.reason ?? "-"}`);
          }
          return { matched: true };
        }
        if (subcommand === "versions") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec versions <spec-id> [--limit n] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const versions = await specifications.listVersions(specId, parsed.options.limit);
          if (parsed.options.json) {
            deps.writeJson({ specId, versions });
          } else {
            for (const version of versions) {
              deps.writeText(`${version.id}\tv${version.version}\ttasks=${version.taskSnapshot.length}\t${version.createdAt}\t${version.reason ?? "-"}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "diff") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec diff <spec-id> [--from version-id-or-number] [--to version-id-or-number|current] [--save-artifact] [--artifact-name name] [--json]");
            deps.setExitCode(1);
            return { matched: true };
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
            deps.writeJson(diffResult);
          } else {
            deps.writeText(`${diff.from} -> ${diff.to}\tspecChanges=${diff.specChanges.length}\tadded=${diff.summary.addedTasks}\tremoved=${diff.summary.removedTasks}\tchanged=${diff.summary.changedTasks}`);
            if ("artifact" in diffResult) {
              deps.writeText(`artifact\t${diffResult.artifact.id}\tsha256=${diffResult.artifact.sha256}`);
            }
            for (const change of diff.specChanges) {
              deps.writeText(`spec.${change.field}\t${change.before}\t=>\t${change.after}`);
            }
            for (const change of diff.taskChanges) {
              deps.writeText(`${change.change}\t${change.taskId}\tfields=${change.fields.join(",")}\t${change.title}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "plan") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec plan <spec-id> [--version version-id] [--title title] [--summary text] [--status draft|active] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const plan = await specifications.generatePlan({
            actor,
            specId,
            versionId: parsed.options.versionId,
            title: parsed.options.title,
            summary: parsed.options.summary,
            status: parsed.options.status ? deps.parseSpecificationPlanStatus(parsed.options.status, ["draft", "active"]) : undefined,
          });
          if (parsed.options.json) {
            deps.writeJson(plan);
          } else {
            deps.writeText(`${plan.id}\t${plan.status}\tsteps=${plan.steps.length}\topenClarifications=${plan.openClarificationIds.length}\t${plan.title}`);
          }
          return { matched: true };
        }
        if (subcommand === "plans") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec plans <spec-id> [--status draft|active|superseded|archived] [--limit n] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const plans = await specifications.listPlans({
            specId,
            status: parsed.options.status ? deps.parseSpecificationPlanStatus(parsed.options.status) : undefined,
            limit: parsed.options.limit,
          });
          if (parsed.options.json) {
            deps.writeJson({ specId, plans });
          } else {
            for (const plan of plans) {
              deps.writeText(`${plan.id}\t${plan.status}\tsteps=${plan.steps.length}\topenClarifications=${plan.openClarificationIds.length}\t${plan.createdAt}\t${plan.title}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "request-plan-approval") {
          const specId = args[0];
          const planId = args[1];
          const parsed = deps.parseArgs(args.slice(2));
          if (!specId || !planId) {
            deps.writeError("Usage: agent spec request-plan-approval <spec-id> <plan-id> [reason]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const approval = await specifications.requestPlanApproval({
            actor,
            specId,
            planId,
            reason: parsed.positionals.join(" ").trim() || parsed.options.reason,
          });
          deps.writeText(`${approval.id}\t${approval.status}\t${approval.action}\t${approval.reason}`);
          return { matched: true };
        }
        if (subcommand === "clarify") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          const question = parsed.positionals.join(" ").trim();
          if (!specId || !question) {
            deps.writeError("Usage: agent spec clarify <spec-id> <question>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const clarification = await specifications.createClarification({
            actor,
            specId,
            question,
          });
          deps.writeText(`${clarification.id}\t${clarification.status}\t${clarification.question}`);
          return { matched: true };
        }
        if (subcommand === "clarifications") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec clarifications <spec-id> [--status open|answered|resolved] [--limit n] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const clarifications = await specifications.listClarifications({
            specId,
            status: parsed.options.status ? deps.parseSpecificationClarificationStatus(parsed.options.status) : undefined,
            limit: parsed.options.limit,
          });
          if (parsed.options.json) {
            deps.writeJson({ specId, clarifications });
          } else {
            for (const clarification of clarifications) {
              deps.writeText(`${clarification.id}\t${clarification.status}\t${clarification.updatedAt}\t${clarification.question}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "answer") {
          const specId = args[0];
          const clarificationId = args[1];
          const parsed = deps.parseArgs(args.slice(2));
          const answer = parsed.positionals.join(" ").trim();
          if (!specId || !clarificationId || !answer) {
            deps.writeError("Usage: agent spec answer <spec-id> <clarification-id> [--resolve] <answer>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const clarification = await specifications.answerClarification({
            actor,
            specId,
            clarificationId,
            answer,
            status: parsed.options.resolve ? "resolved" : parsed.options.status ? deps.parseAnswerClarificationStatus(parsed.options.status) : undefined,
          });
          deps.writeText(`${clarification.id}\t${clarification.status}\t${clarification.updatedAt}\t${clarification.question}`);
          return { matched: true };
        }
        if (subcommand === "task") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          const title = parsed.positionals.join(" ").trim();
          if (!specId || !title) {
            deps.writeError("Usage: agent spec task <spec-id> [--path path] [--depends-on task-id] [--parallel] [--verify text] <title>");
            deps.setExitCode(1);
            return { matched: true };
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
          deps.writeText(`${task.id}\t${task.status}\torder=${task.order}\tparallel=${task.parallelizable}\t${task.title}`);
          return { matched: true };
        }
        if (subcommand === "tasks") {
          const specId = args[0];
          if (!specId) {
            deps.writeError("Usage: agent spec tasks <spec-id>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const tasks = await specifications.listTasks(specId);
          for (const task of tasks) {
            deps.writeText(`${task.id}\t${task.status}\torder=${task.order}\tparallel=${task.parallelizable}\tpaths=${task.paths.join(",") || "-"}\t${task.title}`);
          }
          return { matched: true };
        }
        if (subcommand === "validate") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec validate <spec-id> [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const result = await specifications.validateDag(specId);
          if (parsed.options.json) {
            deps.writeJson(result);
          } else {
            deps.writeText(`${result.specId}\tvalid=${result.valid}\ttasks=${result.taskCount}\tissues=${result.issues.length}`);
            for (const issue of result.issues) {
              deps.writeText(`${issue.type}\t${issue.taskId}\t${issue.dependencyId ?? "-"}\t${issue.message}`);
            }
          }
          if (!result.valid) {
            deps.setExitCode(1);
          }
          return { matched: true };
        }
        if (subcommand === "next" || subcommand === "ready") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId) {
            deps.writeError("Usage: agent spec next <spec-id> [--limit n] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const tasks = await specifications.listReadyTasks({
            specId,
            limit: parsed.options.limit,
          });
          if (parsed.options.json) {
            deps.writeJson({ specId, tasks });
          } else {
            for (const task of tasks) {
              deps.writeText(`${task.id}\t${task.status}\torder=${task.order}\tparallel=${task.parallelizable}\tpaths=${task.paths.join(",") || "-"}\t${task.title}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "status") {
          const specId = args[0];
          const taskId = args[1];
          const status = args[2];
          if (!specId || !taskId || !status) {
            deps.writeError("Usage: agent spec status <spec-id> <task-id> pending|in_progress|completed|blocked");
            deps.setExitCode(1);
            return { matched: true };
          }
          const task = await specifications.updateTaskStatus({
            actor,
            specId,
            taskId,
            status: deps.parseSpecificationTaskStatus(status),
          });
          deps.writeText(`${task.id}\t${task.status}\t${task.updatedAt}\t${task.title}`);
          return { matched: true };
        }
        if (subcommand === "verify") {
          const specId = args[0];
          const taskId = args[1];
          const status = args[2];
          const parsed = deps.parseArgs(args.slice(3));
          const evidence = parsed.options.evidence ?? parsed.positionals.join(" ").trim();
          if (!specId || !taskId || !status || !evidence) {
            deps.writeError("Usage: agent spec verify <spec-id> <task-id> passed|failed [--artifact artifact-id] <evidence>");
            deps.setExitCode(1);
            return { matched: true };
          }
          const task = await specifications.recordTaskVerification({
            actor,
            specId,
            taskId,
            status: deps.parseSpecificationVerificationStatus(status),
            evidence,
            artifactRefs: parsed.options.artifactRefs,
          });
          deps.writeText(`${task.id}\t${task.status}\tverification=${status}\t${task.title}`);
          return { matched: true };
        }
        if (subcommand === "evidence") {
          const specId = args[0];
          const taskId = args[1];
          const parsed = deps.parseArgs(args.slice(2));
          if (!specId || !taskId || !parsed.options.provider || !parsed.options.conclusion) {
            deps.writeError("Usage: agent spec evidence <spec-id> <task-id> --provider github|gitlab|generic --conclusion success|failure|cancelled|skipped|neutral|timed_out|action_required [--check name] [--run-id id] [--url url] [--sha sha] [--branch branch] [--external-id id]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const task = await specifications.recordProviderEvidence({
            actor,
            specId,
            taskId,
            provider: deps.parseSpecificationEvidenceProvider(parsed.options.provider),
            conclusion: deps.parseSpecificationEvidenceConclusion(parsed.options.conclusion),
            checkName: parsed.options.checkName,
            runId: parsed.options.runId,
            runUrl: parsed.options.url,
            commitSha: parsed.options.sha,
            branch: parsed.options.branch,
            externalId: parsed.options.externalId,
            artifactRefs: parsed.options.artifactRefs,
          });
          deps.writeText(`${task.id}\t${task.status}\tprovider=${parsed.options.provider}\tconclusion=${parsed.options.conclusion}\t${task.title}`);
          return { matched: true };
        }
        if (subcommand === "verifications") {
          const specId = args[0];
          const taskId = args[1]?.startsWith("--") ? undefined : args[1];
          const parsed = deps.parseArgs(args.slice(taskId ? 2 : 1));
          if (!specId) {
            deps.writeError("Usage: agent spec verifications <spec-id> [task-id] [--verification-status passed|failed] [--limit n] [--json]");
            deps.setExitCode(1);
            return { matched: true };
          }
          const verifications = await specifications.listTaskVerifications({
            specId,
            taskId,
            status: parsed.options.verificationStatus ? deps.parseSpecificationVerificationStatus(parsed.options.verificationStatus) : undefined,
            limit: parsed.options.limit,
          });
          if (parsed.options.json) {
            deps.writeJson({ specId, taskId, verifications });
          } else {
            for (const verification of verifications) {
              deps.writeText(`${verification.id}\t${verification.taskId}\t${verification.status}\t${verification.createdAt}\tartifacts=${verification.artifactRefs.join(",") || "-"}\t${verification.evidence}`);
            }
          }
          return { matched: true };
        }
        if (subcommand === "delegate") {
          const specId = args[0];
          const taskId = args[1];
          const parsed = deps.parseArgs(args.slice(2));
          if (!specId || !taskId) {
            deps.writeError("Usage: agent spec delegate <spec-id> <task-id> [--room room-id] [--assigned-agent agent-id] [--execution-mode trusted|balanced|strict|full_access] [--risk low|medium|high|critical]");
            deps.setExitCode(1);
            return { matched: true };
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
          deps.writeJson({
            specId: result.specification.id,
            taskId: result.task.id,
            taskStatus: result.task.status,
            subtaskId: result.subtask.id,
            childSessionId: result.subtask.childSessionId,
            next: `agent assignments assign-subtask ${result.subtask.id} --worker <worker-id>`,
          });
          return { matched: true };
        }
        if (subcommand === "dispatch") {
          const specId = args[0];
          const parsed = deps.parseArgs(args.slice(1));
          if (!specId || (!parsed.options.workerId && !parsed.options.autoSelectWorker)) {
            deps.writeError("Usage: agent spec dispatch <spec-id> (--worker worker-id|--auto-select-worker) [--plan plan-id] [--require-plan-approval] [--required-plan-approvals n] [--limit n] [--max-load-ratio n] [--max-queued-per-worker n] [--ttl seconds] [--priority n] [--room room-id] [--assigned-agent agent-id]");
            deps.setExitCode(1);
            return { matched: true };
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
            deps.writeJson({ specId, dispatched: results });
          } else {
            for (const result of results) {
              deps.writeText(`${result.task.id}\t${result.task.status}\tsubtask=${result.subtask.id}\tassignment=${result.assignment.id}\tworker=${result.assignment.workerId}\t${result.task.title}`);
            }
          }
          return { matched: true };
        }
        deps.writeError(`Unknown spec command: ${subcommand}`);
        deps.setExitCode(1);
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      } finally {
        platform.close();
      }
      return { matched: true };
    },
  };
}
