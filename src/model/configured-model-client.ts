import type { ModelClient, ModelProviderConfig, ModelRequest } from "./model-client.js";
import type { ModelResponse } from "../protocol/types.js";

export class ConfiguredModelClient implements ModelClient {
  constructor(
    private readonly inner: ModelClient,
    private readonly provider: ModelProviderConfig,
  ) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    return this.inner.complete({
      ...request,
      provider: this.provider,
    });
  }
}
