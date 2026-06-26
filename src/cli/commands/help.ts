import type { CommandModule } from "../command-router.js";

export function createHelpCommand(renderHelp: (args: string[]) => void): CommandModule<void> {
  return {
    name: "help",
    aliases: ["--help", "-h"],
    summary: "Show Soloclaw help",
    execute: async ({ args }) => {
      renderHelp(args);
      return { matched: true };
    },
  };
}
