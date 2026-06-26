import type { ModelClient, ModelProviderConfig, ModelRequest, ModelStreamEvent } from "./model-client.js";
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

  async *streamComplete(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const routedRequest = {
      ...request,
      provider: this.provider,
    };
    const stream = this.inner.streamComplete?.(routedRequest);
    if (stream) {
      yield* stream;
      return;
    }
    yield await this.inner.complete(routedRequest);
  }
}
