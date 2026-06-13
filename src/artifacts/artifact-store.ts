import type { ActorRef, ArtifactRecord } from "../domain/index.js";

export type ArtifactLocationKind = "local_file" | "object_storage" | "external_uri";

export type ArtifactContentRef = {
  kind: ArtifactLocationKind;
  uri?: string;
  path?: string;
  bucket?: string;
  key?: string;
  sha256?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
};

export type PutArtifactInput = {
  record: ArtifactRecord;
  content?: Uint8Array | string;
  contentRef?: ArtifactContentRef;
  actor: ActorRef;
};

export type PutArtifactResult = {
  record: ArtifactRecord;
  contentRef: ArtifactContentRef;
};

export type GetArtifactContentInput = {
  artifactId: string;
  actor: ActorRef;
};

export type GetArtifactContentResult = {
  record: ArtifactRecord;
  content?: Uint8Array;
  contentRef?: ArtifactContentRef;
};

export type DeleteArtifactContentInput = {
  artifactId: string;
  actor: ActorRef;
  reason?: string;
};

export interface ArtifactStore {
  put(input: PutArtifactInput): Promise<PutArtifactResult>;
  get(input: GetArtifactContentInput): Promise<GetArtifactContentResult | undefined>;
  delete(input: DeleteArtifactContentInput): Promise<ArtifactRecord | undefined>;
}
