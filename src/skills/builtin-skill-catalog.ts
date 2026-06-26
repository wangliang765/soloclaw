export type BuiltinSkillDefinition = {
  name: string;
  version: string;
  description: string;
  permissions: string[];
  tools: string[];
  body: string;
};

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  {
    name: "tdd-regression",
    version: "0.1.0",
    description: "Use behavior-first tests and red-green verification for bug fixes and new behavior.",
    permissions: ["workspace.read", "workspace.write", "shell.run.safe"],
    tools: ["read_file", "search_text", "apply_patch", "run_command"],
    body: `# TDD Regression

Use this when implementing behavior or fixing a bug.

Workflow:
- Write or update a focused failing test first.
- Run the focused test and confirm the failure matches the target behavior.
- Implement the smallest change that makes the test pass.
- Run the focused test again.
- Run the relevant broader check before claiming completion.
- Keep temporary reproduction files out of the final workspace unless they become permanent regression tests.`,
  },
  {
    name: "systematic-debugging",
    version: "0.1.0",
    description: "Diagnose failures by reproducing, tracing, and testing one hypothesis at a time.",
    permissions: ["workspace.read", "shell.run.safe"],
    tools: ["read_file", "search_text", "run_command"],
    body: `# Systematic Debugging

Use this when something is failing, flaky, slow, or surprising.

Workflow:
- Reproduce the symptom with the smallest command available.
- Capture the exact failing output or state.
- Compare against the nearest working example in the repository.
- Change one variable at a time.
- Prefer evidence from tests, logs, and source reads over guesses.
- Stop and report the blocking evidence when the issue cannot be reproduced locally.`,
  },
  {
    name: "verification-before-completion",
    version: "0.1.0",
    description: "Require fresh verification evidence before completion claims.",
    permissions: ["workspace.read", "shell.run.safe"],
    tools: ["run_command", "read_file", "search_text"],
    body: `# Verification Before Completion

Use this before saying work is complete, fixed, ready, or passing.

Workflow:
- Identify the command or inspection that proves the claim.
- Run the full command fresh in the current workspace.
- Read the output and exit status.
- Report the verified result and any remaining risk.
- If verification cannot run, say exactly what did not run and why.`,
  },
  {
    name: "code-review",
    version: "0.1.0",
    description: "Review changes for bugs, regressions, security issues, and missing tests before summarizing.",
    permissions: ["workspace.read", "shell.run.safe"],
    tools: ["read_file", "search_text", "run_command"],
    body: `# Code Review

Use this when asked to review code or before merging a meaningful change.

Workflow:
- Inspect the diff and changed files.
- Lead with findings ordered by severity.
- Include file and line references for actionable issues.
- Call out missing tests or residual risk.
- Keep summaries secondary to findings.`,
  },
  {
    name: "codebase-design",
    version: "0.1.0",
    description: "Design deep modules with small interfaces, clear seams, and local test surfaces.",
    permissions: ["workspace.read"],
    tools: ["read_file", "search_text"],
    body: `# Codebase Design

Use this when shaping module boundaries or improving an interface.

Vocabulary:
- Module: anything with an interface and implementation.
- Interface: every fact callers must know to use a module correctly.
- Seam: the place where behavior can vary without editing callers.
- Adapter: a concrete implementation at a seam.

Design rule:
- Prefer deep modules: small interface, meaningful behavior, focused tests.`,
  },
  {
    name: "plan-execution",
    version: "0.1.0",
    description: "Execute a written plan task by task with checkpoints and verification after each task.",
    permissions: ["workspace.read", "workspace.write", "shell.run.safe"],
    tools: ["read_file", "search_text", "apply_patch", "run_command", "todowrite"],
    body: `# Plan Execution

Use this when implementing a checked plan.

Workflow:
- Read the plan and identify the current unchecked task.
- Keep a current task list.
- Implement one task at a time.
- Run the task's verification command before moving on.
- Update the plan checkbox only when the task's evidence exists.`,
  },
  {
    name: "handoff-resume",
    version: "0.1.0",
    description: "Create or consume compact handoffs for long-running Soloclaw sessions.",
    permissions: ["workspace.read", "shell.run.safe"],
    tools: ["read_file", "search_text", "run_command"],
    body: `# Handoff Resume

Use this when resuming or handing off work.

Workflow:
- Identify the latest objective, changed files, verification evidence, and blockers.
- Do not restart discovery unless the handoff is stale or contradicted by the workspace.
- Continue from the last verified state.
- Preserve unresolved risks in the final answer.`,
  },
  {
    name: "phase-evidence-closeout",
    version: "0.1.0",
    description: "Close Soloclaw phase evidence without counting templates or local-only smoke as real-machine evidence.",
    permissions: ["workspace.read", "workspace.write", "shell.run.safe"],
    tools: ["read_file", "search_text", "apply_patch", "run_command"],
    body: `# Phase Evidence Closeout

Use this when updating Soloclaw phase status.

Rules:
- Generated Phase 5 templates, runbooks, and collector guides are not completed evidence.
- Phase 4 macOS and Android Termux require real host evidence.
- Phase 5 real room closure requires real target fragments and final evidence-check success.
- Record only paste-safe summaries in committed docs.
- Keep raw tokens, invite bundles, private keys, signed envelopes, and room bodies out of committed files.`,
  },
  {
    name: "cross-platform-smoke",
    version: "0.1.0",
    description: "Run and record Windows, Linux, macOS, and Android Termux local agent smoke checks safely.",
    permissions: ["workspace.read", "shell.run.safe"],
    tools: ["read_file", "search_text", "run_command"],
    body: `# Cross Platform Smoke

Use this for platform evidence.

Workflow:
- Run the documented platform command on the actual target OS.
- Record platform id, command exit status, and secret scan result.
- Do not substitute Git Bash for Linux, WSL for macOS, or generated docs for device evidence.
- Keep raw local config and secret paths out of public summaries.`,
  },
  {
    name: "room-evidence-collector",
    version: "0.1.0",
    description: "Collect and preflight Phase 5 room evidence fragments across real machines.",
    permissions: ["workspace.read", "workspace.write", "shell.run.safe"],
    tools: ["read_file", "search_text", "apply_patch", "run_command"],
    body: `# Room Evidence Collector

Use this for Phase 5 real-machine collection.

Workflow:
- Use exact target ids from the matrix.
- Preflight each target fragment with phase5 evidence-check --target.
- Merge only valid fragments.
- Run the final full evidence-check on the merged file.
- Keep guides, templates, raw tokens, and raw signed envelopes out of committed docs.`,
  },
];
