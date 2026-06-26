export type InstructionSourceKind = "managed" | "global" | "project" | "config" | "nearby";

export type InstructionSource = {
  kind: InstructionSourceKind;
  path: string;
  priority: number;
  trustedAsInstruction: boolean;
  content: string;
};

export type InstructionAttachment = {
  label: string;
  content: string;
  source: Pick<InstructionSource, "kind" | "path" | "trustedAsInstruction">;
};

export type ResolvedInstructions = {
  sources: InstructionSource[];
  attachments: InstructionAttachment[];
};
