# AtlasLM RAG Architecture

## Ingestion Path

1. `app/api/documents/route.ts` validates PDF, TXT, or Markdown uploads up to 4 MB.
2. PDF text is reconstructed page by page. Repeated short header/footer lines are removed before indexing.
3. `src/lib/chunking.ts` computes a content fingerprint and deterministic UUIDs. Re-uploading identical content addresses the same document workspace.
4. Text is split into page-aware recursive windows with a 640-token target and 80-token overlap. Oversized paragraphs fall back to sentence windows, then word windows.
5. Each chunk keeps original citation text and gets a separate contextual retrieval representation containing source, page, heading, and adjacent context.
6. Exact duplicate chunks are removed by content hash.
7. OpenRouter embeds the contextual retrieval representations.
8. Qdrant stores vectors and payload metadata in a cosine HNSW collection. On Qdrant 1.18+, the collection uses real 4-bit TurboQuant with original vectors retained for rescoring.

## Query Path

1. The current question is combined with the last conversation turns to make follow-up retrieval self-contained.
2. OpenRouter creates one query embedding.
3. Qdrant performs a wide filtered ANN search for the active `documentId` while AtlasLM scans that document's payloads for BM25.
4. Reciprocal Rank Fusion combines dense and lexical ranks without assuming their raw scores share a scale.
5. A deterministic feature reranker scores query coverage, phrase matches, retrieval agreement, and original rank.
6. Precision mode optionally asks a low-cost LLM to rerank the leading candidates as one list and judge evidence sufficiency.
7. MMR selects relevant but non-redundant passages.
8. The evidence gate checks retrieval strength, score agreement, coverage, and whether exact identifiers requested by the user are present.
9. Weak evidence in Strict mode abstains before generation, saving cost and preventing unsupported completion.
10. Otherwise the answer model receives only numbered evidence passages, conversation context, and strict source-grounding rules.
11. A citation auditor parses individual and grouped citations, rejects unknown source IDs, and measures claim coverage.
12. The response contains the answer, evidence objects, confidence, retrieval counters, evaluation checks, and a timed trace.

## Retrieval Modes

### Efficient

- Dense ANN + BM25 + RRF
- Deterministic feature reranker
- MMR evidence selection
- One generation call when evidence is sufficient
- Best default for a small OpenRouter balance

### Precision

- Everything in Efficient mode
- One additional listwise LLM reranking/sufficiency call
- Falls back to feature reranking if the judge call fails
- Best for a final recruiter demo or difficult source

## Grounding Boundary

The model never decides what source material exists. Retrieval is scoped by an exact Qdrant `documentId` filter. Untrusted document text is delimited as evidence, and the prompt explicitly says instructions inside it are data, not system instructions. Strict mode has two independent brakes: evidence insufficiency before generation and citation integrity after generation.

## Confidence Is An Explanation, Not A Probability

The UI's confidence value is a transparent heuristic composed from retrieval strength, query-term coverage, agreement between dense and lexical signals, evidence breadth, and optional LLM sufficiency. It should not be presented as a statistically calibrated probability of truth. The underlying component scores and reasons are exposed so the user can challenge it.

## TurboQuant

`src/lib/qdrant.ts` requests this Qdrant 1.18 quantization shape:

```json
{
  "turbo": {
    "bits": "bits4",
    "always_ram": true
  }
}
```

Search uses quantized candidates with oversampling and rescoring against original vectors. AtlasLM probes collection creation and safely retries without quantization when the server does not support TurboQuant. This is a real database configuration, not only a memory-estimate chart.

## Key Modules

| Module | Responsibility |
| --- | --- |
| `src/lib/chunking.ts` | Contextual chunking, deterministic identity, deduplication |
| `src/lib/qdrant.ts` | Collection lifecycle, TurboQuant, ANN, payload filters |
| `src/lib/scoring.ts` | BM25, RRF, feature rerank, MMR |
| `src/lib/grounding.ts` | Conversation query, sufficiency, citations, abstention |
| `src/lib/openrouter.ts` | Embeddings, listwise reranker, grounded generation |
| `src/lib/cache.ts` | Document-scoped semantic cache |
| `src/lib/tracing.ts` | Trace IDs, spans, latency, tokens, cache state |
| `src/lib/evaluation.ts` | Per-response grounding checks |
| `src/lib/rag.ts` | End-to-end orchestration |

## Known Production Extensions

- Replace the in-memory semantic cache with Redis for durable multi-instance caching.
- Store BM25 in a sparse-vector or full-text index for very large corpora instead of scrolling document payloads.
- Add OCR and layout-aware parsing for scanned and table-heavy PDFs.
- Add offline benchmark datasets with answerability labels and retrieval ground truth.
- Add authentication, tenant filters, quotas, deletion, and data-retention controls before multi-user use.
