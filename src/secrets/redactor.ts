export type RedactionResult = {
  text: string;
  redactions: Array<{
    kind: "known_secret" | "pattern" | "entropy";
    label: string;
  }>;
};

export interface Redactor {
  registerKnownSecret(label: string, value: string): Promise<void>;
  redact(input: string): Promise<RedactionResult>;
}
