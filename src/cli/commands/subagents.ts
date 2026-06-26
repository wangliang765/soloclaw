import type { CommandModule } from "../command-router.js";

type ParsedRunArgs = {
  task?: string;
  options: Record<string, any>;
};

type DelegateCommandPlatform = {
  subagents: {
    delegate(input: any): Promise<any>;
  };
  store: {
    close(): void;
  };
};

export type DelegateCommandDeps = {
  cwd(): string;
  parseRunArgs(args: string[]): ParsedRunArgs;
  createPlatform(cwd: string, options: Record<string, any>): Promise<DelegateCommandPlatform>;
  actor(): unknown;
  writeJson(value: unknown): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createDelegateCommand(deps: DelegateCommandDeps): CommandModule<void> {
  return {
    name: "delegate",
    summary: "Delegate a scoped subtask into a child session",
    execute: async ({ args: rest }) => {
      const parsed = deps.parseRunArgs(rest);
      if (!parsed.task) {
        deps.writeError("Missing subtask objective.");
        deps.setExitCode(1);
        return { matched: true };
      }
      const platform = await deps.createPlatform(deps.cwd(), parsed.options);
      try {
        const result = await platform.subagents.delegate({
          objective: parsed.task,
          parentSessionId: parsed.options.parentSessionId,
          roomId: parsed.options.roomId,
          assignedAgentId: parsed.options.assignedAgentId,
          createdBy: deps.actor(),
          executionMode: parsed.options.executionMode ?? "trusted",
        });
        deps.writeJson({
          subtaskId: result.subtask.id,
          status: result.subtask.status,
          childSessionId: result.childSession?.id,
          summary: result.summary,
        });
      } finally {
        platform.store.close();
      }
      return { matched: true };
    },
  };
}

type SubtaskListRecord = {
  id: string;
  status: string;
  createdAt: string;
  childSessionId?: string;
  parentSessionId?: string;
  objective: string;
};

type SubtasksCommandPlatform = {
  store: {
    listSubtasks(parentSessionId?: string): Promise<SubtaskListRecord[] | any[]>;
    close(): void;
  };
};

export type SubtasksCommandDeps = {
  cwd(): string;
  createPlatform(cwd: string): Promise<SubtasksCommandPlatform>;
  writeText(text: string): void;
};

export function createSubtasksCommand(deps: SubtasksCommandDeps): CommandModule<void> {
  return {
    name: "subtasks",
    summary: "List delegated subtasks",
    execute: async ({ args: rest }) => {
      const parentSessionId = rest[0];
      const platform = await deps.createPlatform(deps.cwd());
      try {
        const subtasks = await platform.store.listSubtasks(parentSessionId);
        for (const subtask of subtasks) {
          deps.writeText(`${subtask.id}\t${subtask.status}\t${subtask.createdAt}\tchild=${subtask.childSessionId ?? "-"}\tparent=${subtask.parentSessionId ?? "-"}\t${subtask.objective}`);
        }
      } finally {
        platform.store.close();
      }
      return { matched: true };
    },
  };
}
