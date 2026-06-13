import type { ModelClient, ModelProviderConfig, ModelRequest } from "./model-client.js";
import type { ModelResponse } from "../protocol/types.js";
import { TransientModelProviderError } from "./http-model-clients.js";

export type FallbackModelEntry = {
  client: ModelClient;
  provider?: ModelProviderConfig;
};

export class FallbackModelClient implements ModelClient {
  constructor(private readonly entries: FallbackModelEntry[]) {
    if (entries.length === 0) {
      throw new Error("FallbackModelClient requires at least one provider entry.");
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const transientErrors: string[] = [];
    for (const entry of this.entries) {
      try {
        return await entry.client.complete({
          ...request,
          provider: entry.provider ?? request.provider,
        });
      } catch (error) {
        if (!isTransientProviderError(error)) {
          throw error;
        }
        transientErrors.push(error.message);
      }
    }
    throw new TransientModelProviderError(`All model providers failed transiently: ${transientErrors.join(" | ")}`, "openai_compatible");
  }
}

function isTransientProviderError(error: unknown): error is TransientModelProviderError {
  return error instanceof TransientModelProviderError;
}
