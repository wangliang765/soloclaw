import { strict as assert } from "node:assert";
import test from "node:test";
import { parseContextCompactionCliOptions } from "../cli/context-compaction-options.js";

test("context compaction CLI parser consumes threshold and window flags", () => {
  const parsed = parseContextCompactionCliOptions([
    "--context-window-tokens",
    "1000",
    "--context-compaction-threshold-percent=80",
    "--context-compaction-buffer-tokens",
    "50",
    "--context-output-reserve-tokens=25",
    "--context-compaction-keep-tokens",
    "120",
    "--context-compaction-summary-mode",
    "model",
    "inspect",
    "workspace",
  ]);

  assert.deepEqual(parsed.rest, ["inspect", "workspace"]);
  assert.deepEqual(parsed.contextCompaction, {
    contextWindowTokens: 1000,
    thresholdPercent: 80,
    bufferTokens: 50,
    outputReserveTokens: 25,
    keepRecentTokens: 120,
    summaryMode: "model",
  });
});

test("context compaction CLI parser supports disabling auto compaction", () => {
  const parsed = parseContextCompactionCliOptions([
    "--no-context-compaction",
    "--context-compaction-summary-mode=heuristic",
    "continue",
  ]);

  assert.deepEqual(parsed.rest, ["continue"]);
  assert.deepEqual(parsed.contextCompaction, {
    auto: false,
    summaryMode: "heuristic",
  });
});

test("context compaction CLI parser rejects invalid percentages", () => {
  assert.throws(
    () => parseContextCompactionCliOptions(["--context-compaction-threshold-percent", "101", "task"]),
    /--context-compaction-threshold-percent must be an integer between 1 and 100\./,
  );
});
