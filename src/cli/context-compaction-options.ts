import type { ModelRequestCompactionOptions } from "../core/context-compactor.js";

export type ContextCompactionCliOptions = Omit<ModelRequestCompactionOptions, "messages" | "tools">;

export type ParsedContextCompactionCliOptions = {
  contextCompaction?: ContextCompactionCliOptions;
  rest: string[];
};

export function parseContextCompactionCliOptions(args: string[]): ParsedContextCompactionCliOptions {
  const contextCompaction: ContextCompactionCliOptions = {};
  const rest: string[] = [];
  let sawContextOption = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--no-context-compaction") {
      contextCompaction.auto = false;
      sawContextOption = true;
      continue;
    }
    if (arg === "--context-compaction-auto") {
      contextCompaction.auto = true;
      sawContextOption = true;
      continue;
    }

    const contextWindow = optionValue(args, index, ["--context-window-tokens"]);
    if (contextWindow) {
      contextCompaction.contextWindowTokens = parsePositiveInteger(contextWindow.value, contextWindow.name);
      sawContextOption = true;
      index += contextWindow.consumed - 1;
      continue;
    }

    const buffer = optionValue(args, index, ["--context-compaction-buffer-tokens", "--context-buffer-tokens"]);
    if (buffer) {
      contextCompaction.bufferTokens = parseNonNegativeInteger(buffer.value, buffer.name);
      sawContextOption = true;
      index += buffer.consumed - 1;
      continue;
    }

    const outputReserve = optionValue(args, index, ["--context-output-reserve-tokens", "--context-compaction-output-reserve-tokens"]);
    if (outputReserve) {
      contextCompaction.outputReserveTokens = parseNonNegativeInteger(outputReserve.value, outputReserve.name);
      sawContextOption = true;
      index += outputReserve.consumed - 1;
      continue;
    }

    const keepRecent = optionValue(args, index, ["--context-compaction-keep-tokens", "--context-keep-tokens"]);
    if (keepRecent) {
      contextCompaction.keepRecentTokens = parseNonNegativeInteger(keepRecent.value, keepRecent.name);
      sawContextOption = true;
      index += keepRecent.consumed - 1;
      continue;
    }

    const threshold = optionValue(args, index, [
      "--context-compaction-threshold-percent",
      "--context-threshold-percent",
      "--compact-at-percent",
    ]);
    if (threshold) {
      contextCompaction.thresholdPercent = parsePercentageInteger(threshold.value, threshold.name);
      sawContextOption = true;
      index += threshold.consumed - 1;
      continue;
    }

    const summaryMode = optionValue(args, index, ["--context-compaction-summary-mode", "--context-summary-mode"]);
    if (summaryMode) {
      contextCompaction.summaryMode = parseSummaryMode(summaryMode.value, summaryMode.name);
      sawContextOption = true;
      index += summaryMode.consumed - 1;
      continue;
    }

    rest.push(arg);
  }

  return {
    contextCompaction: sawContextOption ? contextCompaction : undefined,
    rest,
  };
}

function optionValue(
  args: string[],
  index: number,
  names: string[],
): { name: string; value: string; consumed: number } | undefined {
  const arg = args[index];
  for (const name of names) {
    if (arg === name) {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${name} requires a value.`);
      }
      return { name, value, consumed: 2 };
    }
    if (arg.startsWith(`${name}=`)) {
      return { name, value: arg.slice(name.length + 1), consumed: 1 };
    }
  }
  return undefined;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parsePercentageInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error(`${name} must be an integer between 1 and 100.`);
  }
  return parsed;
}

function parseSummaryMode(value: string, name: string): NonNullable<ContextCompactionCliOptions["summaryMode"]> {
  if (value === "heuristic" || value === "model" || value === "auto") {
    return value;
  }
  throw new Error(`${name} must be heuristic, model, or auto.`);
}
