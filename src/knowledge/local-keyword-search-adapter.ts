import type { SearchAdapter, SearchAdapterOutput, SearchAdapterQuery, SearchDocument } from "./search-adapter.js";
import type { KnowledgeChunk } from "../domain/index.js";
import type { KnowledgeSafetyFinding } from "./knowledge-service.js";

export class LocalKeywordSearchAdapter implements SearchAdapter {
  private documents: SearchDocument[] = [];

  async index(input: { documents: SearchDocument[] }): Promise<void> {
    this.documents = [...input.documents];
  }

  async search(input: SearchAdapterQuery): Promise<SearchAdapterOutput> {
    const terms = tokenize(input.query);
    if (terms.length === 0) {
      return emptyOutput(this.documents.length);
    }
    let unsafeCandidateCount = 0;
    let filteredBySafety = 0;
    const safetyMode = input.safetyMode ?? "annotate";
    const results = this.documents
      .filter((document) => (input.sourceId ? document.chunk.sourceId === input.sourceId : true))
      .map((document) => {
        const score = scoreChunk(document.chunk, terms);
        if (score <= 0) {
          return undefined;
        }
        const safetyFindings = safetyMode === "off" ? [] : scanKnowledgeSafety(document.chunk.content);
        if (safetyFindings.length > 0) {
          unsafeCandidateCount += 1;
          if (safetyMode === "exclude") {
            filteredBySafety += 1;
            return undefined;
          }
        }
        return {
          chunk: document.chunk,
          source: document.source,
          score,
          snippet: makeSnippet(document.chunk.content, terms),
          safetyFindings,
          metadata: { mode: "keyword" },
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== undefined)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 5);

    return {
      results,
      diagnostics: {
        candidateCount: this.documents.length,
        scoredCount: results.length,
        unsafeCandidateCount,
        filteredBySafety,
      },
    };
  }

  async removeSource(sourceId: string): Promise<void> {
    this.documents = this.documents.filter((document) => document.chunk.sourceId !== sourceId);
  }
}

function emptyOutput(candidateCount: number): SearchAdapterOutput {
  return {
    results: [],
    diagnostics: {
      candidateCount,
      scoredCount: 0,
      unsafeCandidateCount: 0,
      filteredBySafety: 0,
    },
  };
}

const KNOWLEDGE_SAFETY_RULES: Array<{ rule: string; severity: KnowledgeSafetyFinding["severity"]; reason: string; pattern: RegExp }> = [
  {
    rule: "ignore_previous_instructions",
    severity: "high",
    reason: "The chunk appears to instruct the model to ignore higher-priority instructions.",
    pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above|earlier)\s+instructions\b/i,
  },
  {
    rule: "secret_exfiltration",
    severity: "high",
    reason: "The chunk appears to request disclosure or exfiltration of secrets or credentials.",
    pattern: /\b(reveal|print|send|exfiltrate|upload)\b.{0,80}\b(secret|secrets|api\s*key|token|credential|credentials)\b/i,
  },
  {
    rule: "safety_disablement",
    severity: "medium",
    reason: "The chunk appears to instruct the model to disable safety or policy controls.",
    pattern: /\b(disable|bypass|turn\s+off)\b.{0,80}\b(safety|policy|guardrail|redaction|audit)\b/i,
  },
  {
    rule: "tool_abuse_instruction",
    severity: "medium",
    reason: "The chunk appears to instruct the model to run tools or commands as an instruction rather than evidence.",
    pattern: /\b(run|execute|call)\b.{0,80}\b(shell|command|tool)\b.{0,80}\b(without\s+approval|without\s+asking|silently)\b/i,
  },
];

function scanKnowledgeSafety(content: string): KnowledgeSafetyFinding[] {
  const findings: KnowledgeSafetyFinding[] = [];
  for (const rule of KNOWLEDGE_SAFETY_RULES) {
    if (rule.pattern.test(content)) {
      findings.push({ rule: rule.rule, severity: rule.severity, reason: rule.reason });
    }
  }
  return findings;
}

function scoreChunk(chunk: KnowledgeChunk, terms: string[]): number {
  const summary = chunk.summary.toLowerCase();
  const content = chunk.content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    score += countOccurrences(summary, term) * 3;
    score += countOccurrences(content, term);
  }
  return score / Math.max(1, Math.sqrt(chunk.tokenCount));
}

function makeSnippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const firstHit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstHit - 120);
  const end = Math.min(content.length, firstHit + 360);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].filter((term) => term.length > 1);
}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let index = value.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = value.indexOf(term, index + term.length);
  }
  return count;
}
