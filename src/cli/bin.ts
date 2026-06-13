#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";

const binPath = process.argv[1] ?? "";
const cliPath = path.join(path.dirname(binPath), "index.js");
const child = spawn(process.execPath, ["--no-warnings", cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
