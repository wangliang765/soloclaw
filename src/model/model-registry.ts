import type { ModelClient, ModelProviderConfig, ModelProviderName } from "./model-client.js";

export interface ModelRegistry {
  register(name: ModelProviderName, client: ModelClient): void;
  get(name: ModelProviderName): ModelClient | undefined;
  completeWith(config: ModelProviderConfig, request: Parameters<ModelClient["complete"]>[0]): ReturnType<ModelClient["complete"]>;
}

export class DefaultModelRegistry implements ModelRegistry {
  private readonly clients = new Map<ModelProviderName, ModelClient>();

  register(name: ModelProviderName, client: ModelClient): void {
    this.clients.set(name, client);
  }

  get(name: ModelProviderName): ModelClient | undefined {
    return this.clients.get(name);
  }

  completeWith(config: ModelProviderConfig, request: Parameters<ModelClient["complete"]>[0]) {
    const client = this.clients.get(config.name);
    if (!client) {
      throw new Error(`No model client registered for provider: ${config.name}`);
    }
    return client.complete({ ...request, provider: config });
  }
}
