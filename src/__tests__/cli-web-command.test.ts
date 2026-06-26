import assert from "node:assert/strict";
import test from "node:test";
import { createWebCommand } from "../cli/commands/web.js";

test("createWebCommand starts the local web server with parsed options", async () => {
  const events: string[] = [];
  const signals = new Map<string, () => void>();
  const command = createWebCommand({
    cwd: () => "C:/repo",
    startServer: async (cwd, options) => {
      events.push(`start:${cwd}:${JSON.stringify(options)}`);
      return {
        url: "http://127.0.0.1:4318/?token=test",
        close: () => events.push("close"),
      };
    },
    onSignal: (signal, handler) => {
      events.push(`signal:${signal}`);
      signals.set(signal, handler);
    },
    exit: (code) => events.push(`exit:${code}`),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exitCode:${code}`),
  });

  const result = await command.execute({
    command: "web",
    args: ["--host", "0.0.0.0", "--port", "4318", "--token", "test"],
    context: undefined,
  });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    'start:C:/repo:{"host":"0.0.0.0","port":4318,"token":"test"}',
    "text:Room Web UI: http://127.0.0.1:4318/?token=test",
    "signal:SIGINT",
    "signal:SIGTERM",
  ]);

  signals.get("SIGINT")?.();
  assert.deepEqual(events.slice(4), ["close", "exit:0"]);
});

test("createWebCommand closes the server on SIGTERM", async () => {
  const events: string[] = [];
  const signals = new Map<string, () => void>();
  const command = createWebCommand({
    cwd: () => "C:/repo",
    startServer: async () => ({
      url: "http://127.0.0.1:4317/",
      close: () => events.push("close"),
    }),
    onSignal: (signal, handler) => signals.set(signal, handler),
    exit: (code) => events.push(`exit:${code}`),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exitCode:${code}`),
  });

  await command.execute({ command: "web", args: [], context: undefined });
  signals.get("SIGTERM")?.();

  assert.deepEqual(events, [
    "text:Room Web UI: http://127.0.0.1:4317/",
    "close",
    "exit:0",
  ]);
});

test("createWebCommand reports invalid port errors", async () => {
  const events: string[] = [];
  const command = createWebCommand({
    cwd: () => "C:/repo",
    startServer: async () => {
      events.push("start");
      return { url: "http://127.0.0.1:4317/", close: () => events.push("close") };
    },
    onSignal: () => events.push("signal"),
    exit: (code) => events.push(`exit:${code}`),
    writeText: (text) => events.push(`text:${text}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exitCode:${code}`),
  });

  const result = await command.execute({ command: "web", args: ["--port", "99999"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Invalid port: 99999", "exitCode:1"]);
});
