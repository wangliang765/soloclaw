import type { CommandModule } from "../command-router.js";

export type WebCommandOptions = {
  host?: string;
  port?: number;
  token?: string;
};

export type WebCommandServer = {
  url: string;
  close(): void;
};

export type WebCommandSignal = "SIGINT" | "SIGTERM";

export type WebCommandDeps<TServer extends WebCommandServer> = {
  cwd(): string;
  startServer(cwd: string, options: WebCommandOptions): Promise<TServer>;
  onSignal(signal: WebCommandSignal, handler: () => void): void;
  exit(code: number): void;
  writeText(text: string): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
};

export function createWebCommand<TServer extends WebCommandServer>(
  deps: WebCommandDeps<TServer>,
): CommandModule<void> {
  return {
    name: "web",
    summary: "Start the local room web console",
    execute: async ({ args }) => {
      try {
        const options = parseWebArgs(args);
        const server = await deps.startServer(deps.cwd(), options);
        deps.writeText(`Room Web UI: ${server.url}`);
        deps.onSignal("SIGINT", () => {
          server.close();
          deps.exit(0);
        });
        deps.onSignal("SIGTERM", () => {
          server.close();
          deps.exit(0);
        });
      } catch (error) {
        deps.writeError(error instanceof Error ? error.message : String(error));
        deps.setExitCode(1);
      }
      return { matched: true };
    },
  };
}

function parseWebArgs(args: string[]): WebCommandOptions {
  const options: WebCommandOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--host" && next) {
      options.host = next;
      index += 1;
      continue;
    }
    if (arg === "--port" && next) {
      const port = Number(next);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid port: ${next}`);
      }
      options.port = port;
      index += 1;
      continue;
    }
    if (arg === "--token" && next) {
      options.token = next;
      index += 1;
    }
  }
  return options;
}
