export type TuiCommand = {
  name: string;
  command: string;
  description: string;
};

export const TUI_COMMANDS: TuiCommand[] = [
  { name: "/models", command: "/models", description: "Configure or switch model provider" },
  { name: "/model setup", command: "/model setup", description: "Configure model provider and API key" },
  { name: "/mode [plan|build|goal]", command: "/mode", description: "Switch task mode" },
  { name: "/approve plan", command: "/approve plan", description: "Approve the current plan and execute in Build mode" },
  { name: "/model check", command: "/model check", description: "Check active model readiness" },
  { name: "/status", command: "/status", description: "Show workspace and model status" },
  { name: "/phase2 status", command: "/phase2 status", description: "Show Phase 2 closure blockers" },
  { name: "/phase2 gate", command: "/phase2 gate", description: "Show Phase 2 gate blockers and next actions" },
  { name: "/phase2 next", command: "/phase2 next", description: "Show only the next Phase 2 closeout action" },
  { name: "/phase2 review", command: "/phase2 review", description: "Show C1/C2/C3 evidence and review status" },
  { name: "/phase2 evidence C1", command: "/phase2 evidence C1", description: "Show one redacted Phase 2 evidence section for review" },
  { name: "/phase2 launch-terminal", command: "/phase2 launch-terminal", description: "Show the C1 external terminal launch command" },
  { name: "/phase2 final-gate", command: "/phase2 final-gate", description: "Show the C3 automated gate command sequence" },
  { name: "/phase2 readiness", command: "/phase2 readiness", description: "Show real-provider readiness for Phase 2" },
  { name: "/phase2 checklist", command: "/phase2 checklist", description: "Show Phase 2 manual closeout checklist" },
  { name: "/phase2 closeout-guide", command: "/phase2 closeout-guide", description: "Show step-by-step Phase 2 acceptance guide" },
  { name: "/phase2 operator-runbook", command: "/phase2 operator-runbook", description: "Show one-sitting Phase 2 operator commands" },
  { name: "/phase2 closeout-wizard", command: "/phase2 closeout-wizard", description: "Show guided Phase 2 evidence prompt commands" },
  { name: "/phase2 evidence-template", command: "/phase2 evidence-template", description: "Show paste-safe Phase 2 evidence template" },
  { name: "/phase2 evidence-record", command: "/phase2 evidence-record", description: "Record paste-safe Phase 2 evidence notes" },
  { name: "/phase2 closure-task", command: "/phase2 closure-task", description: "Check a reviewed Phase 2 closure task" },
  { name: "/phase2 evidence-check [--strict]", command: "/phase2 evidence-check", description: "Check Phase 2 evidence notes for sections and secret shapes" },
  { name: "/sessions", command: "/sessions", description: "Open recent sessions picker" },
  { name: "/continue", command: "/continue", description: "Continue the stopped Goal session" },
  { name: "/resume [session-id|number]", command: "/resume", description: "Resume the active or selected session" },
  { name: "/pause [reason]", command: "/pause", description: "Pause the active Goal session" },
  { name: "/cancel [reason]", command: "/cancel", description: "Cancel the active Goal session" },
  { name: "/background", command: "/background", description: "Queue the active Goal session for worker continuation" },
  { name: "/goal status", command: "/goal status", description: "Show durable Goal progress" },
  { name: "/clear", command: "/clear", description: "Clear transcript and run state" },
  { name: "/help", command: "/help", description: "Show commands" },
  { name: "/exit", command: "/exit", description: "Quit Soloclaw" },
];

export function commandSuggestionsForInput(input: string): TuiCommand[] {
  const prefix = commandPrefix(input);
  if (!prefix.startsWith("/")) {
    return [];
  }
  return TUI_COMMANDS.filter((entry) => entry.command.startsWith(prefix) || entry.name.startsWith(prefix));
}

export function commonCommandPrefix(commands: TuiCommand[]): string {
  if (commands.length === 0) {
    return "";
  }
  let prefix = commands[0]?.command ?? "";
  for (const command of commands.slice(1)) {
    while (prefix && !command.command.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

function commandPrefix(input: string): string {
  return input.trimStart();
}
