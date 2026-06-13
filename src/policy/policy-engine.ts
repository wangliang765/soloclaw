import type { PolicyDecision, PolicyRequest } from "../domain/index.js";

export interface PolicyEngine {
  evaluate(request: PolicyRequest): Promise<PolicyDecision>;
}
