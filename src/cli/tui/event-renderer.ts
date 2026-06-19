import type { AgentRunEvent } from "../../core/agent-events.js";
import type { ProjectedAssistantPart } from "../../core/agent-message-projector.js";
import { ansi, clip } from "./ansi.js";

export function renderEventRow(event: AgentRunEvent, width = 100): string {
  switch (event.type) {
    case "session_started":
      return clip(`${ansi.purple}>${ansi.reset} Session ${event.sessionId}`, width);
    case "step_started":
      return clip(`${ansi.gray}.${ansi.reset} Thinking step ${event.step}`, width);
    case "model_finished":
      return clip(`${ansi.gray}.${ansi.reset} Model ${event.responseType} in ${event.durationMs}ms`, width);
    case "model_failed":
      return clip(`${ansi.orange}ERR${ansi.reset} Model failed in ${event.durationMs}ms`, width);
    case "reasoning_started":
      return clip(`${ansi.gray}.${ansi.reset} ${event.publicSummary}`, width);
    case "reasoning_delta": {
      const tail = [
        event.deltaCount > 0 ? `${event.deltaCount} parts` : undefined,
        event.elapsedMs !== undefined ? `${event.elapsedMs}ms` : undefined,
      ].filter(Boolean).join(", ");
      return clip(`${ansi.gray}.${ansi.reset} ${event.publicSummary}${tail ? ` (${tail})` : ""}`, width);
    }
    case "reasoning_finished":
      return clip(`${ansi.gray}.${ansi.reset} ${event.publicSummary} ${event.durationMs}ms`, width);
    case "assistant_note":
      return clip(`${ansi.gray}-${ansi.reset} ${event.text}`, width);
    case "assistant_text":
      return clip(`${ansi.purple}>${ansi.reset} ${event.text}`, width);
    case "tool_started":
      return clip(`${ansi.gray}.${ansi.reset} ${event.title}${event.detailsHidden ? " (details hidden)" : ""}`, width);
    case "tool_finished": {
      const icon = event.status === "ok" ? "OK" : "ERR";
      const tail = [
        event.exitCode !== undefined ? `exit=${event.exitCode ?? "-"}` : undefined,
        event.timedOut ? "timed out" : undefined,
        event.durationMs !== undefined ? `${event.durationMs}ms` : undefined,
        event.detailsHidden ? "details hidden" : undefined,
      ].filter(Boolean).join(", ");
      return clip(`${event.status === "ok" ? ansi.purple : ansi.orange}${icon}${ansi.reset} ${event.title}${tail ? ` (${tail})` : ""}`, width);
    }
    case "file_changed":
      return clip(`${ansi.purple}FILE${ansi.reset} ${event.change} ${event.path}`, width);
    case "step_limit_reached":
      return clip(`${ansi.orange}!${ansi.reset} Step budget reached: ${event.maxSteps}`, width);
    case "run_failed":
      return clip(`${ansi.orange}ERR${ansi.reset} ${event.message}`, width);
  }
}

export function renderProjectedAssistantPartRow(part: ProjectedAssistantPart, width = 100, options: { expanded?: boolean } = {}): string {
  switch (part.type) {
    case "text":
      return clip(`${ansi.purple}>${ansi.reset} ${part.text}`, width);
    case "status": {
      const tail = [
        part.step !== undefined ? `step=${part.step}` : undefined,
        part.durationMs !== undefined ? `${part.durationMs}ms` : undefined,
      ].filter(Boolean).join(", ");
      return clip(`${ansi.gray}.${ansi.reset} ${part.title}${tail ? ` (${tail})` : ""}`, width);
    }
    case "error": {
      const tail = part.durationMs !== undefined ? ` (${part.durationMs}ms)` : "";
      return clip(`${ansi.orange}ERR${ansi.reset} ${part.title}${tail}`, width);
    }
    case "tool": {
      const icon = part.status === "failed" ? "ERR" : part.status === "ok" ? "OK" : ".";
      const color = part.status === "failed" ? ansi.orange : part.status === "ok" ? ansi.purple : ansi.gray;
      const collapsedTail = [
        part.exitCode !== undefined ? `exit=${part.exitCode ?? "-"}` : undefined,
        part.timedOut ? "timed out" : undefined,
        part.durationMs !== undefined ? `${part.durationMs}ms` : undefined,
        part.detailsHidden ? "details hidden" : undefined,
      ].filter(Boolean).join(", ");
      const expandedTail = options.expanded ? safeToolDetailsTail(part) : undefined;
      const tail = expandedTail || collapsedTail;
      return clip(`${color}${icon}${ansi.reset} ${part.title}${tail ? ` (${tail})` : ""}`, width);
    }
  }
}

function safeToolDetailsTail(part: Extract<ProjectedAssistantPart, { type: "tool" }>): string | undefined {
  const details = part.safeDetails;
  if (!details) {
    return undefined;
  }
  const tail = [
    details.paths?.length ? `paths=${details.paths.join(",")}` : undefined,
    details.exitCode !== undefined ? `exit=${details.exitCode ?? "-"}` : undefined,
    details.timedOut ? "timed out" : undefined,
    details.durationMs !== undefined ? `${details.durationMs}ms` : undefined,
    details.stdoutBytes !== undefined ? `stdout=${details.stdoutBytes}B` : undefined,
    details.stderrBytes !== undefined ? `stderr=${details.stderrBytes}B` : undefined,
    part.detailsHidden ? "details hidden" : undefined,
  ].filter(Boolean).join(", ");
  return tail || undefined;
}
