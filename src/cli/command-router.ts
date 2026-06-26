export type CommandExecutionInput<TContext> = {
  command: string;
  args: string[];
  context: TContext;
};

export type CommandExecutionResult = {
  matched: boolean;
  exitCode?: number;
};

export type CommandModule<TContext> = {
  name: string;
  aliases?: string[];
  summary: string;
  execute(input: CommandExecutionInput<TContext>): Promise<CommandExecutionResult>;
};

export class CommandRouter<TContext> {
  private readonly modulesByCommand = new Map<string, CommandModule<TContext>>();

  constructor(modules: CommandModule<TContext>[]) {
    for (const module of modules) {
      this.register(module.name, module);
      for (const alias of module.aliases ?? []) {
        this.register(alias, module);
      }
    }
  }

  async execute(input: CommandExecutionInput<TContext>): Promise<CommandExecutionResult> {
    const module = this.modulesByCommand.get(input.command);
    if (!module) {
      return { matched: false };
    }
    return module.execute(input);
  }

  listModules(): CommandModule<TContext>[] {
    return [...new Set(this.modulesByCommand.values())];
  }

  private register(command: string, module: CommandModule<TContext>): void {
    if (this.modulesByCommand.has(command)) {
      throw new Error(`Duplicate CLI command registration: ${command}`);
    }
    this.modulesByCommand.set(command, module);
  }
}
