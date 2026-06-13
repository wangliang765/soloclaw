import type { PolicyDecision, PolicyRequest } from "../domain/index.js";
import type { PolicyEngine } from "./policy-engine.js";

const WRITE_ACTIONS = new Set(["workspace.write", "git.commit.create", "git.push", "git.pr.create"]);
const HIGH_RISK_ACTIONS = new Set(["shell.run.high_risk", "dependency.install", "git.mutation", "secret.read"]);

export class DefaultPolicyEngine implements PolicyEngine {
  async evaluate(request: PolicyRequest): Promise<PolicyDecision> {
    if (request.mode === "full_access") {
      return { type: "allow", reason: "Full access mode allows this action." };
    }

    if (request.mode === "strict") {
      return { type: "ask", reason: "Strict mode requires approval for tool actions.", approverHint: "human" };
    }

    if (request.risk === "critical") {
      return { type: "ask", reason: "Critical risk requires explicit approval.", approverHint: "human" };
    }

    if (request.action === "plugin.execute" && request.risk === "high") {
      return { type: "ask", reason: "High-risk plugin execution requires approval.", approverHint: "human" };
    }

    if (request.action === "mcp.connect" && request.risk === "high") {
      return { type: "ask", reason: "High-risk MCP connection requires approval.", approverHint: "human" };
    }

    if (HIGH_RISK_ACTIONS.has(request.action)) {
      return { type: "ask", reason: "High-risk action requires approval.", approverHint: "human" };
    }

    if (request.mode === "balanced" && WRITE_ACTIONS.has(request.action)) {
      return { type: "ask", reason: "Balanced mode requires approval for writes and Git mutations.", approverHint: "human" };
    }

    return { type: "allow", reason: "Action allowed by default policy." };
  }
}
