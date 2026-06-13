import type { RedactionResult, Redactor } from "./redactor.js";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "openai_like_key"],
  [/\bghp_[A-Za-z0-9_]{20,}\b/g, "github_pat"],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "gitlab_pat"],
];

export class BasicRedactor implements Redactor {
  private readonly knownSecrets = new Map<string, string>();

  async registerKnownSecret(label: string, value: string): Promise<void> {
    if (value.length > 0) {
      this.knownSecrets.set(label, value);
    }
  }

  async redact(input: string): Promise<RedactionResult> {
    let text = input;
    const redactions: RedactionResult["redactions"] = [];

    for (const [label, value] of this.knownSecrets) {
      if (text.includes(value)) {
        text = text.split(value).join(`[REDACTED:${label}]`);
        redactions.push({ kind: "known_secret", label });
      }
    }

    for (const [pattern, label] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        pattern.lastIndex = 0;
        text = text.replace(pattern, `[REDACTED:${label}]`);
        redactions.push({ kind: "pattern", label });
      }
    }

    return { text, redactions };
  }
}
