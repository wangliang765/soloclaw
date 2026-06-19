import type { AgentMessage, ToolCall, ToolResult } from "../protocol/types.js";

export class ContextManager {
  private readonly messages: AgentMessage[];

  constructor(systemPrompt: string, userTask: string, initialMessages?: AgentMessage[]) {
    this.messages = initialMessages ? [...initialMessages] : [];
    if (!initialMessages) {
      this.messages.push({ role: "system", content: systemPrompt });
      this.messages.push({ role: "user", content: userTask });
    }
  }

  static fromMessages(messages: AgentMessage[]): ContextManager {
    return new ContextManager("", "", messages);
  }

  addAssistant(content: string, toolCalls: ToolCall[] = []) {
    this.messages.push({ role: "assistant", content, toolCalls });
  }

  addUser(content: string) {
    this.messages.push({ role: "user", content });
  }

  addToolResult(result: ToolResult) {
    this.messages.push({
      role: "tool",
      content: JSON.stringify(result),
      toolResult: result,
    });
  }

  snapshot(): AgentMessage[] {
    return [...this.messages];
  }
}
