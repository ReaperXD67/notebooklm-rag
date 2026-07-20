# AtlasLM Research And Interview Guide

This guide explains what AtlasLM actually implements, why the design choices matter, how to demonstrate them, and where the system is deliberately honest about its limits.

## 1. The One-Minute Explanation

AtlasLM is an evidence operating system for uploaded documents. A basic RAG application embeds chunks, retrieves the nearest few, and asks an LLM to answer. AtlasLM treats each of those steps as a possible failure point.

During ingestion it normalizes noisy PDFs, creates deterministic identities, removes duplicates, builds context-enriched retrieval text, and stores vectors in a real Qdrant 1.18 TurboQuant index. During a question it runs dense and lexical retrieval in parallel, fuses ranks, reranks candidates, removes redundancy, checks whether the evidence is sufficient, and only then permits generation. After generation it audits citations. The UI exposes evidence, scores, rank movement, confidence reasons, evals, and the complete request trace.

The key design principle is: **retrieval quality, answerability, generation, and verification are different problems and should be measured separately.**

## 2. Assignment Coverage

| Marking criterion | Evidence in AtlasLM |
| --- | --- |
| GitHub repository | Public Next.js/TypeScript repository with CI, Docker, tests, and documentation |
| Live project | Vercel-compatible application using OpenRouter and Qdrant Cloud |
| Chunking | Page-aware recursive windows, heading carry-forward, overlap, contextual retrieval text, deterministic dedupe |
| Embedding | Batched OpenRouter embedding API |
| Vector storage | Qdrant HNSW with metadata filters and Qdrant 1.18 TurboQuant capability negotiation |
| Retrieval | Dense ANN + BM25 + RRF + feature/LLM reranking + MMR |
| Generation | Source-only prompt; retrieved context is numbered and isolated from system instructions |
| Grounded quality | Sufficiency gate, exact-identifier check, citations, citation audit, abstention, visible evidence |
| Code quality | Typed modules, Zod API validation, Vitest, CI, traces, environment template, documented limitations |

## 3. The Ten-Layer Pipeline

### 3.1 Ingest And Normalize

Implemented in `app/api/documents/route.ts` and `src/lib/chunking.ts`.

- Accepts PDF, TXT, and Markdown up to 4 MB.
- Preserves PDF page boundaries for page citations.
- Reconstructs line-broken PDF text and removes repeated short page-margin lines.
- Computes a SHA-256 content fingerprint and deterministic UUIDs.
- Keeps original chunk text for truthful citations.
- Builds a separate `retrievalText` with document, page, heading, and adjacent context.
- Hashes and removes exact duplicate chunks before embedding.

Why it matters: embedding malformed line fragments or repeated headers wastes vector storage and produces deceptively similar candidates. Deterministic identity also makes re-upload behavior easier to reason about and test.

### 3.2 Hybrid Retrieval

Implemented in `src/lib/qdrant.ts`, `src/lib/scoring.ts`, and `src/lib/rag.ts`.

- Dense ANN finds semantic paraphrases.
- BM25 finds exact terms, rare names, error codes, numbers, and identifiers.
- Reciprocal Rank Fusion combines positions instead of mixing incompatible raw score scales.
- Retrieval is filtered by `documentId`, enforcing the source boundary at the database query.

Why RRF instead of `0.7 * vector + 0.3 * keyword`: cosine similarity and BM25 do not have naturally comparable scales. A fixed weighted sum can silently change behavior across embedding models and document lengths. RRF is rank-based and more stable.

### 3.3 ANN And Reranking

AtlasLM retrieves a wider candidate pool than it ultimately sends to generation.

- Stage 1: Qdrant HNSW ANN and BM25 provide high-recall candidates.
- Stage 2 Efficient mode: deterministic features rerank query coverage, phrase matches, dense/lexical agreement, RRF, and original rank.
- Stage 2 Precision mode: one listwise LLM call judges the leading candidates together and also returns an evidence-sufficiency opinion.
- MMR selects evidence that is relevant without repeating nearly identical passages.

If the optional LLM reranker fails, the trace records the error and AtlasLM falls back to the deterministic reranker instead of failing the whole answer.

### 3.4 Source Confidence And Sufficiency

Implemented in `src/lib/grounding.ts`.

Confidence considers:

- top retrieval strength;
- query-term coverage across selected evidence;
- agreement between dense and lexical signals;
- evidence breadth and redundancy;
- optional Precision-mode sufficiency judgment;
- requested exact identifiers that are absent from every passage.

The last check is important. A result can be highly relevant to a topic while still not contain the exact invoice number, date, version, person, or amount the question asks for.

The confidence ring is an explainable heuristic, not a mathematically calibrated truth probability. AtlasLM exposes its reasons rather than hiding a single authoritative-looking number.

### 3.5 Constrained Generation

Implemented in `src/lib/openrouter.ts`.

- The model receives numbered evidence passages and the user's question.
- It is told to use only evidence-supported facts.
- It must cite factual claims with `[S#]` references.
- It must state when a detail is absent.
- Instructions found inside uploaded content are explicitly treated as untrusted data.
- Low temperature reduces creative drift.

This is defense in depth, not blind trust in a prompt. The pre-generation gate and post-generation citation auditor remain independent controls.

### 3.6 Citation-Backed Responses

Each response returns structured source objects with:

- source name, page, heading, and chunk number;
- original citation text;
- dense, lexical, RRF, hybrid, and rerank scores;
- original and final rank.

The UI turns `[S1]` citations into evidence controls. The auditor supports grouped citations such as `[S1, S3]`, checks source IDs, and estimates claim coverage.

### 3.7 Hallucination Fallback

Strict mode can stop an answer at two points:

1. **Before generation:** evidence is insufficient, so AtlasLM returns a reasoned abstention and avoids paying for an answer call.
2. **After generation:** citation coverage or integrity fails, so AtlasLM blocks the draft.

This is stronger than adding “do not hallucinate” to the system prompt because it creates observable program decisions around the model.

### 3.8 Continuous Evaluation

Implemented in `src/lib/evaluation.ts`, `app/api/evaluate/route.ts`, `src/tests`, and `.github/workflows/quality.yml`.

- Unit tests cover deterministic chunk IDs and dedupe, BM25, RRF, reranking, MMR, exact-identifier insufficiency, grouped citations, and evaluation behavior.
- Every answer returns checks for evidence selection, citation integrity, trace health, and abstention correctness.
- The Evals tab can run an adversarial canary that asks for a deliberately absent identifier and expects abstention.
- GitHub Actions runs typechecking, tests, and a production build.

A mature next step is a versioned benchmark set containing questions, answerability labels, expected source chunks, and factual reference answers. Retrieval and generation metrics should then be reported separately.

### 3.9 Caching And Memory

Implemented in `src/lib/cache.ts` and `src/lib/grounding.ts`.

- Recent conversation turns are used to make follow-up retrieval queries self-contained.
- A short-lived semantic cache compares query embeddings with cosine similarity.
- Cache entries are scoped by document, retrieval mode, strictness, and evidence depth.
- Only a fully audited structured response is cached.
- Cache hits are visible in the trace and skip retrieval/generation work.

The current cache is process-local and appropriate for the assignment/demo scale. Redis would be required for durable sharing across Vercel instances.

### 3.10 Observability

Implemented in `src/lib/tracing.ts` and displayed as the RAG Flight Recorder.

Each response contains:

- a unique trace ID;
- total latency;
- ordered spans and their status;
- embedding, ANN, lexical scan, fusion, reranking, MMR, sufficiency, generation, and audit timing;
- cache hit state;
- model and token usage;
- candidate and evidence counts;
- fallback and failure details.

Qdrant requests also carry the same trace ID. This makes “the answer was bad” diagnosable: the problem may be ingestion, retrieval recall, ranking, sufficiency, generation, or citation compliance.

## 4. Research Ideas Used

### TurboQuant

Google Research introduced TurboQuant as an extreme vector-compression approach using randomized rotations, scalar quantization, and a residual estimator. Qdrant 1.18 added production TurboQuant support. AtlasLM creates a `bits4` TurboQuant collection, keeps original vectors for rescoring, and reports whether quantization was actually accepted by the server.

Why this is credible:

- the database collection configuration contains `quantization_config.turbo`;
- the Docker stack pins Qdrant 1.18;
- search requests enable quantized candidate search with oversampling and rescoring;
- unsupported servers trigger a safe uncompressed fallback;
- the UI reports actual availability, not just a theoretical compression graphic.

Do not claim that TurboQuant always improves search quality. Qdrant reports strong recall/compression results for its implementation, while later independent analysis questioned the reproducibility of some broad benchmark claims. The engineering decision is to make it measurable and replaceable, not magical.

Sources:

- [Google Research: TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
- [Qdrant 1.18 release](https://qdrant.tech/blog/qdrant-1.18.x/)
- [Revisiting RaBitQ and TurboQuant](https://arxiv.org/abs/2604.19528)

### Contextual Retrieval

Anthropic's Contextual Retrieval adds short chunk-specific context before embedding and BM25 indexing. AtlasLM implements a deterministic, zero-extra-LLM-cost version: `retrievalText` includes source, page, heading, and adjacent content while the original text remains the citation surface.

Source: [Anthropic: Introducing Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)

### Sufficient Context

Google Research showed that retrieved context can be relevant yet insufficient to answer a question. AtlasLM therefore separates ranking from answerability. Efficient mode uses transparent evidence signals; Precision mode adds an LLM sufficiency judgment; Strict mode abstains when the gate fails.

Source: [Google Research: The role of sufficient context in RAG](https://research.google/blog/deeper-insights-into-retrieval-augmented-generation-the-role-of-sufficient-context/)

### Evidence-Based Abstention

Recent evidence-based abstention research argues that a single scalar confidence score is often not enough. AtlasLM returns confidence reasons, missing terms, source scores, citation audit results, and the full trace alongside the abstention decision.

## 5. What Makes The UI Different

AtlasLM's interface is designed as an operational research workbench rather than a decorative chat page.

- **Source control:** upload, identity, dedupe, indexing latency, vector dimensions, and quantization state.
- **Corpus Field:** a live canvas maps chunks and retrieved sources into a clickable topology; moving packets, scan lines, and active nodes reflect retrieval state.
- **Retrieval controls:** Efficient/Precision segmented control, evidence-depth slider, and Strict grounding toggle.
- **Grounded thread:** questions and answers remain the center of the workflow.
- **Evidence console:** inspect passages, scores, pages, and rank changes.
- **Trace console:** see every pipeline stage and cost signal.
- **Eval console:** inspect automatic checks and run a live adversarial probe.
- **Stack console:** verify the ten production layers and TurboQuant configuration.

The design is intentionally dense, calm, and scan-friendly. The color system assigns distinct jobs: lime for active/healthy state, cyan for retrieval evidence, coral for warnings, and violet for document identity.

## 6. Demo Script For A Recruiter

Use a document containing specific facts, dates, and one topic that it never mentions.

1. Open the Source control panel and upload the unseen file.
2. Point out its content fingerprint, duplicate count, chunk count, index time, dimensions, and `turboquant-4bit` status.
3. Ask a direct factual question in Efficient mode.
4. Open a citation and show the exact page and source passage.
5. Open Evidence and explain dense versus lexical scores and original versus final rank.
6. Open Trace and show parallel retrieval, fusion, sufficiency, generation, and citation audit spans.
7. Repeat the same question and show the semantic cache hit with generation skipped.
8. Ask a follow-up using a pronoun to demonstrate conversational retrieval memory.
9. Switch to Precision mode for a difficult comparison question and show the listwise reranker.
10. Ask for a fake exact identifier or run the adversarial probe. Show that Strict mode abstains instead of improvising.
11. Open Stack and connect each checklist item to the working request.

This sequence demonstrates quality, cost awareness, observability, and failure handling rather than only a successful answer.

## 7. Likely Interview Questions

### Why not use only vector similarity?

Dense embeddings are strong on paraphrases but can miss rare exact strings. BM25 is strong on exact terms but weak on semantic paraphrases. Hybrid retrieval covers both failure modes, and RRF avoids pretending their raw scores are directly comparable.

### Why retrieve many candidates and send only a few?

ANN is optimized for recall. A second ranking stage can apply richer query-specific signals. MMR then removes duplicate evidence so the LLM sees broader support within a limited context budget.

### Why is a relevant chunk not always sufficient?

A passage may discuss the right topic but omit the exact value or relationship requested. AtlasLM explicitly checks coverage and exact identifiers and can abstain before generation.

### Can citations alone stop hallucinations?

No. A model can attach a citation to an unsupported claim. AtlasLM also exposes the cited passage, audits citation IDs and coverage, and separates evidence sufficiency from citation formatting. Full claim-to-evidence entailment is a valuable future evaluation layer.

### What does TurboQuant change?

It compresses the vector representation used for candidate search. AtlasLM still stores payload text and preserves original vectors for rescoring. Quantization reduces vector memory and can improve cache efficiency, but recall must be benchmarked on the actual dataset.

### What happens if OpenRouter reranking fails?

Precision mode catches the failure, records it in the trace, and continues with deterministic feature ranking. Generation can still proceed if the evidence gate passes.

### How would this scale to millions of chunks?

Move lexical retrieval into Qdrant sparse vectors or a search engine, paginate ingestion with a job queue, store cache and traces in shared services, use tenant-aware payload indexes, and benchmark HNSW/TurboQuant recall. The current corpus scan is intentionally simple for single-document assignment scale.

### How do you prevent documents from injecting prompts?

Uploaded text is wrapped as untrusted evidence and explicitly cannot override system rules. More importantly, document content never chooses tools or retrieval scope, and output still passes a citation audit. Production should also add file scanning, parser isolation, and policy filters.

### How do you know the system is better?

The architecture creates measurable stages. Retrieval can be measured with Recall@K, MRR, and nDCG; answerability with sufficiency/abstention accuracy; generation with citation correctness and factuality; operations with p50/p95 latency, cache hit rate, cost, and failure rate. AtlasLM already returns the data structure needed for these measurements and includes initial automated canaries.

## 8. Cost Model

For one uncached Efficient-mode question:

1. one query embedding call;
2. local/Qdrant retrieval and deterministic reranking;
3. zero generation calls if Strict mode abstains, otherwise one answer call.

Precision mode adds one low-cost listwise reranker/sufficiency call. A semantic cache hit currently still embeds the query to find a near match but skips retrieval, reranking, and generation. This is a deliberate quality/cost compromise for a small balance.

## 9. Local And Deployment Commands

### Docker, recommended

```powershell
Copy-Item .env.example .env.local
# Edit OPENROUTER_API_KEY in .env.local
docker compose up --build
```

- AtlasLM: `http://localhost:3002`
- Qdrant: `http://localhost:6333`
- Stop: `docker compose down`
- Remove persisted local vectors only when intentionally resetting: `docker compose down --volumes`

### Native Next.js

```powershell
npm install
npm run dev -- -p 3002
```

Set `QDRANT_URL=http://localhost:6333` when Qdrant runs locally.

### Quality checks

```powershell
npm run typecheck
npm test
npm run build
npm run eval
```

### Vercel

Create a Qdrant Cloud 1.18+ cluster, add all `.env.example` variables in Vercel Project Settings, and deploy. Never place secrets in `NEXT_PUBLIC_*` variables because those are exposed to the browser.

## 10. Honest Limitations And Next Research Steps

- **Layout understanding:** plain PDF extraction cannot reliably understand complex tables, figures, or scans. Add OCR and layout-aware models.
- **Lexical scale:** BM25 currently scores the active document corpus in the application. Use Qdrant sparse vectors or a dedicated lexical engine for large multi-document collections.
- **Confidence calibration:** current confidence is explainable but heuristic. Calibrate thresholds against a labeled answerability set.
- **Citation entailment:** the auditor validates references and coverage, not full semantic entailment for every clause. Add a claim decomposition and natural-language-inference evaluator.
- **Persistent memory:** conversation history is request-provided and the cache is process-local. Add authenticated notebook storage and Redis.
- **Graph retrieval:** cross-document entities and multi-hop relationships are not represented as a graph. Add graph retrieval only after benchmarks show it helps the target questions.
- **Multi-tenancy:** production needs authentication, tenant filters, quotas, deletion, encryption policy, and retention controls.
- **Evaluation depth:** the live canary is useful but small. Add a regression dataset, retrieval ground truth, adversarial prompt-injection documents, and automated cost/latency budgets.

The strongest interview position is not “this system cannot hallucinate.” It is: **AtlasLM turns hallucination risk into observable, testable decisions and knows when not to answer.**
