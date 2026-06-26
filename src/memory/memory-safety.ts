import type { MemorySafetyFinding } from "../domain/index.js";

const MEMORY_SAFETY_RULES: Array<{ rule: string; severity: MemorySafetyFinding["severity"]; reason: string; pattern: RegExp }> = [
  {
    rule: "secret_shaped_value",
    severity: "high",
    reason: "Memory content appears to contain a raw credential or token-shaped value.",
    pattern: /\b(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16})\b/,
  },
  {
    rule: "ignore_previous_instructions",
    severity: "high",
    reason: "Memory content attempts to override higher-priority instructions.",
    pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above|system|developer)\s+instructions\b/i,
  },
  {
    rule: "secret_exfiltration",
    severity: "high",
    reason: "Memory content asks to reveal or exfiltrate secrets.",
    pattern: /\b(reveal|print|send|upload|exfiltrate)\b.{0,80}\b(secret|secrets|api\s*key|token|credential|credentials)\b/i,
  },
  {
    rule: "tool_abuse_instruction",
    severity: "medium",
    reason: "Memory content attempts to instruct silent tool or command execution.",
    pattern: /\b(run|execute|call)\b.{0,80}\b(command|tool|shell)\b.{0,80}\b(silently|without\s+approval|without\s+asking)\b/i,
  },
];

export function scanMemorySafety(content: string): MemorySafetyFinding[] {
  return MEMORY_SAFETY_RULES
    .filter((rule) => rule.pattern.test(content))
    .map((rule) => ({ rule: rule.rule, severity: rule.severity, reason: rule.reason }));
}

export function hasBlockingMemorySafetyFinding(findings: MemorySafetyFinding[]): boolean {
  return findings.some((finding) => finding.severity === "high");
}
