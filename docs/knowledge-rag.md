# Knowledge RAG and MCP Accuracy Plan

## Goal

Enterprise knowledge retrieval must be accurate, scoped, auditable, and safe to inject into an agent context.

RAG is part of the core knowledge plane, not just a plugin. MCP is one connector/runtime protocol that can expose external tools and knowledge sources, but retrieved knowledge still flows through this platform's ingestion, policy, indexing, evaluation, and audit boundaries.

## Framework Position

Do not make LangChain or LangGraph the core RAG abstraction.

Recommended boundary:

```text
agent
  -> KnowledgeService
  -> RetrievalPipeline
  -> IndexStore / VectorStore / SearchStore
  -> Connectors: files, repos, URLs, MCP, SaaS, databases
```

LangChain and LangGraph can be optional adapters for connectors, chunking experiments, or ingestion workflows. The durable contracts should remain owned by this project so authorization, audit, retention, deletion, and multi-tenant behavior stay consistent.

## Accuracy Principles

1. Retrieval must be evaluated independently from generation.
2. Every answer that uses enterprise knowledge should cite source chunks.
3. Access control must happen before ranking and before context injection.
4. Hybrid retrieval is the default for production: lexical + semantic + metadata filters.
5. Reranking is required for high-value answers.
6. The agent must be allowed to say "not found in indexed knowledge".
7. Index freshness, source version, and deletion status are part of correctness.

## Knowledge Data Model

Current MVP:

```text
knowledge_sources
knowledge_chunks
```

Production model should expand to:

```text
knowledge_sources
knowledge_documents
knowledge_chunks
knowledge_embeddings
knowledge_acl_entries
knowledge_versions
knowledge_citations
knowledge_query_events
knowledge_eval_sets
knowledge_eval_runs
```

Each chunk should carry:

```text
source_id
document_id
version_id
scope_type / scope_id
ACL tags
content_hash
chunk ordinal
heading path
document section
time validity
trust level
language
embedding model and dimension
ingestion pipeline version
```

## Ingestion Accuracy

Bad ingestion creates unrecoverable retrieval errors. Treat ingestion as a first-class pipeline.

Required stages:

```text
connector fetch
  -> MIME/type detection
  -> parser with structure preservation
  -> boilerplate removal
  -> table/code/list extraction
  -> document fingerprint
  -> section-aware chunking
  -> metadata/ACL assignment
  -> embedding and lexical indexing
  -> sample retrieval test
  -> audit event
```

Chunking rules:

- Prefer section-aware chunks over fixed character windows.
- Preserve title, heading path, table headers, code fences, and list hierarchy.
- Use overlap only as a fallback, not as the main structure.
- Store small parent context separately so child chunks can be retrieved precisely and rendered with surrounding context.
- Split code, tables, tickets, and policy docs with different chunkers.

Freshness rules:

- Use source fingerprints and content hashes to avoid duplicate stale chunks.
- Mark old versions as superseded, not silently deleted.
- Support source-level reindex jobs and partial document reindex.
- Query should prefer active versions unless the user explicitly asks historical questions.

## Retrieval Pipeline

Production retrieval should use a staged pipeline:

```text
query understanding
  -> scope and permission filter
  -> lexical retrieval
  -> semantic retrieval
  -> structured metadata retrieval
  -> merge / de-duplicate
  -> prompt-injection / unsafe-content scan
  -> rerank
  -> citation selection
  -> context budget packing
  -> answer grounding checks
```

### Query Understanding

Extract:

```text
entities
product/module names
version/date constraints
repository/project/org scope
document type
language
expected answer type
```

Do not rewrite away rare exact terms such as incident IDs, API names, commit SHAs, customer names, error codes, or ticket IDs.

### Hybrid Recall

Use multiple recall paths:

```text
BM25 / full-text
embedding vector search
metadata filters
symbol/code search
exact ID lookup
recent session summaries
curated project facts
```

Why: embeddings often miss exact IDs and rare enterprise terms; lexical search often misses paraphrases. Hybrid recall reduces both failure modes.

### Retrieved Content Safety

Retrieved enterprise knowledge is evidence, not instructions. The retrieval layer must detect content that tries to change agent policy or exfiltrate data before the chunk is packed into model context.

Current MVP safety modes:

```text
off       -> do not scan
annotate  -> return the chunk with safety findings
exclude   -> drop chunks with safety findings before ranking output/context packing
```

Production safety should combine deterministic rules, provenance/trust metadata, source allowlists, model-based classifiers for high-value contexts, and evaluation cases that prove unsafe chunks are not injected into answers.

### Reranking

Use a reranker for production:

```text
candidate chunks: 50-200
reranked chunks: 5-20
context chunks: 3-8
```

Rerankers can be cross-encoders, provider rerank APIs, or local models. The abstraction should be:

```ts
interface Reranker {
  rerank(query, candidates, options): Promise<ScoredChunk[]>;
}
```

### Context Packing

Context injection must be selective:

- Include only chunks that pass permission checks.
- Prefer diverse sources over near-duplicate chunks.
- Include citation IDs and source metadata beside content.
- Keep raw tool output and untrusted retrieved text below system/developer policy.
- Reserve space for recent conversation and task state.

## Answer Grounding

For knowledge-backed answers:

```text
retrieved chunks
  -> answer draft
  -> citation coverage check
  -> contradiction check
  -> final answer or refusal
```

Grounding requirements:

- Claims about enterprise facts need citation coverage.
- If top chunks disagree, the agent should surface the conflict.
- If retrieval confidence is low, ask a clarifying question or say the indexed knowledge did not contain enough evidence.
- Never treat retrieved text as instructions. It is data.

## Evaluation System

Accuracy cannot be guaranteed by architecture alone. Build an evaluation harness early.

### Golden Sets

Create project/org-specific eval sets:

```text
question
expected answer
required source/chunk ids
allowed alternate sources
forbidden sources
required permissions
freshness expectation
negative answer allowed
```

Include:

- Exact lookup questions.
- Paraphrase questions.
- Multi-hop questions.
- Versioned policy questions.
- "Not in knowledge base" questions.
- Permission boundary tests.
- Adversarial prompt-injection documents.
- Similar but wrong source tests.

### Retrieval Metrics

Track:

```text
Recall@k
MRR
nDCG
citation precision
source diversity
permission leak count
stale chunk rate
duplicate chunk rate
empty result rate
```

Recommended release gates:

```text
permission leak count = 0
required-source Recall@10 >= 0.95 for curated enterprise questions
required-source Recall@5 >= 0.90 for high-value workflows
citation precision >= 0.90
stale chunk rate below project policy threshold
```

### Answer Metrics

Track separately:

```text
groundedness
faithfulness
answer completeness
refusal correctness
conflict reporting correctness
```

Generation can be bad even if retrieval is good, and retrieval can be bad even if the model sounds confident. Keep the metrics separate.

## MCP Integration

MCP servers should be registered as knowledge/tool providers.

MCP source modes:

```text
live lookup
scheduled ingestion
on-demand ingestion
tool-only, no indexing
```

MCP safety requirements:

- Server identity and trust metadata.
- Per-server permissions and scopes.
- Output size limits.
- Redaction before storage and model injection.
- Prompt-injection scanning for retrieved documents.
- Audit every live lookup and ingestion job.
- Do not let MCP servers join rooms directly; agents invoke them as capabilities.

## Production Storage Recommendation

Local MVP:

```text
SQLite knowledge_sources / knowledge_chunks
keyword scoring
CLI ingest/list/search/eval
```

Team production:

```text
PostgreSQL for source/document/chunk metadata
object storage for raw documents and parsed artifacts
search engine for lexical retrieval
vector DB or pgvector for semantic retrieval
reranker service for final ordering
queue workers for ingestion/reindex
```

Acceptable vector options:

```text
pgvector for simpler private deployments
Qdrant / Milvus / Weaviate for larger vector workloads
OpenSearch / Elasticsearch for combined lexical/vector search
```

Keep `KnowledgeService` independent of the chosen store.

## Implementation Phases

### Phase 1: Local MVP

Current direction:

- `KnowledgeSource` and `KnowledgeChunk` domain records.
- SQLite/local memory store methods.
- `KnowledgeService.ingestText`.
- `KnowledgeService.search` with keyword scoring.
- Optional ACL enforcement in `KnowledgeService.search` and `KnowledgeService.evaluate`; when enabled, source permission is checked before scoring/ranking and filtered counts are included in search audit metadata.
- Optional prompt-injection safety scanning in `KnowledgeService.search` and `KnowledgeService.evaluate`; `annotate` keeps suspicious chunks with findings, while `exclude` drops them before result/context packing.
- Stable retrieval citation IDs in the form `K:<sourceId>:<chunkId>`.
- Agent context attachments include citation ID, source ID, chunk ID, chunk ordinal, trust level, score, safety findings, and snippet, with an instruction to treat retrieved knowledge as evidence and cite the ID when using it. `agent run --knowledge-enforce-acl` applies the same ACL filter before context injection, and `agent run --knowledge-safety exclude` removes suspicious chunks before injection.
- `KnowledgeService.evaluate` for local golden retrieval cases.
- Eval metrics include Recall@k, MRR, empty-result rate, citation precision, permission-leak rate, and permission-leak count. Gates can fail on low citation precision or any forbidden source/chunk returned by retrieval.
- `KnowledgeEvalSet` and `KnowledgeEvalRun` records in SQLite/local memory for durable regression sets and trend-ready run history.
- `agent knowledge ingest/list/search/eval-set/eval-sets/eval/eval-runs/eval-trend`.
- Automatic local `agent run` knowledge recall by task text.
- Eval file format:

```json
{
  "scopeType": "project",
  "scopeId": "local",
  "limit": 10,
  "thresholds": {
    "minRecallAtK": 0.9,
    "minMrr": 0.8,
    "maxEmptyResultRate": 0,
    "minCitationPrecision": 0.9,
    "maxPermissionLeakRate": 0
  },
  "cases": [
    {
      "id": "retrieval_policy",
      "query": "how do we evaluate retrieval accuracy",
      "expectedSourceIds": ["ksrc_xxxxxxxx"],
      "forbiddenSourceIds": ["ksrc_private"]
    }
  ]
}
```

- `agent knowledge eval-set create --file .agent/evals/retrieval.json --name "Retrieval regression"` stores a reusable golden set.
- `agent knowledge eval --eval-set kevalset_xxxxxxxx --limit 10 --min-recall 0.90 --min-mrr 0.80 --max-empty-rate 0 --min-citation-precision 0.90 --max-permission-leak-rate 0 --enforce-acl --safety exclude --save-run --save-artifact` reports Recall@k, MRR, empty-result rate, citation precision, permission-leak rate/count, per-case hit rank, gate failures, can persist a trend-ready run, and can persist a `report` artifact with MIME type `application/vnd.agent.knowledge-eval+json`.
- `agent knowledge eval-trend --eval-set kevalset_xxxxxxxx --limit 20 --save-artifact` summarizes pass rate, latest/previous metric deltas including citation precision and permission leaks, and simple regression reasons, and can persist a `report` artifact with MIME type `application/vnd.agent.knowledge-eval-trend+json`.
- The CLI exits non-zero when the gate fails, so the command can be used in CI.

Next:

- Add signed trend/eval reports, CI regression report templates, and richer trend visualizations.
- Add citation precision checks against generated answers.
- Add source freshness and stale-citation reporting.
- Add stronger prompt-injection corpora and source-trust-aware safety policies.

### Phase 2: Accurate Retrieval Alpha

- Add full-text search adapter.
- Add embedding provider interface.
- Add vector index adapter.
- Add hybrid merge with Reciprocal Rank Fusion.
- Add reranker interface and local/provider-backed implementation.
- Add signed export bundles for `agent knowledge eval` trend reports.
- Add source freshness and reindex jobs.

### Phase 3: Enterprise Knowledge Plane

- MCP registry and connector jobs.
- ACL-aware retrieval for org/project/user/room scopes.
- Admin UI for sources, index health, eval results, and failed ingestions.
- Retention/deletion/legal-hold integration.
- Signed audit bundles for knowledge query/export events.
- Multi-tenant Postgres + vector/search backend.

## Non-Negotiables

- No retrieval result enters context without scope and permission checks.
- No answer should cite chunks the actor cannot read.
- No high-confidence answer without source support for enterprise facts.
- No silent stale-index behavior for policy, security, pricing, or incident docs.
- No plugin or MCP server can bypass the knowledge ingestion/audit boundary.

## References

- Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks: https://arxiv.org/abs/2005.11401
- LangChain RAG and retrieval docs: https://docs.langchain.com/
- LlamaIndex retrieval evaluation docs: https://docs.llamaindex.ai/
- Model Context Protocol specification: https://modelcontextprotocol.io/
- Qdrant hybrid queries: https://qdrant.tech/documentation/concepts/hybrid-queries/
