import type { Timestamp } from "./common.js";

export type SessionTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type SessionTodoPriority = "high" | "medium" | "low";

export type SessionTodo = {
  content: string;
  status: SessionTodoStatus;
  priority: SessionTodoPriority;
};

export type SessionTodoLedger = {
  sessionId: string;
  todos: SessionTodo[];
  updatedAt: Timestamp;
};
