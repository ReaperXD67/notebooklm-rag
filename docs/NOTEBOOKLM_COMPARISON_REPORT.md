# AtlasLM And NotebookLM: An Honest Comparison

NotebookLM is a polished Google research product with capabilities AtlasLM does not claim to replace, including a mature multi-source workflow and generated Audio Overviews. AtlasLM's advantage for this assignment is not brand-scale feature parity. It is that the entire RAG system is inspectable, configurable, deployable, and measurable.

| Area | NotebookLM | AtlasLM |
| --- | --- | --- |
| Retrieval implementation | Managed and closed | Open TypeScript modules for ANN, BM25, RRF, reranking, and MMR |
| Evidence visibility | User-facing citations | Citations plus source text, page, five retrieval scores, and rank movement |
| Failure behavior | Product-managed | Visible sufficiency gate, exact-identifier checks, abstention, and citation audit |
| Vector infrastructure | Not user configurable | Qdrant 1.18 HNSW with real 4-bit TurboQuant and fallback negotiation |
| Cost controls | Product-managed | Efficient/Precision modes, pre-generation abstention, semantic cache, token trace |
| Observability | Limited product telemetry | Trace ID, timed spans, counters, model, tokens, cache state, fallback details |
| Evaluation | Product-managed | Unit tests, CI, per-response checks, and live adversarial canary |
| Deployment and code | Closed service | Public repository, Docker Compose, Vercel, replaceable providers |
| Audio, OCR, collaboration | Mature product features | Not currently claimed |

## Positioning For An Interview

Do not say “AtlasLM is better than NotebookLM at everything.” Say:

> NotebookLM inspired the interaction model. AtlasLM explores a different question: what would a transparent, evidence-gated, cost-aware RAG system look like if an engineer needed to inspect every decision and swap every component?

That claim is strong because the evaluator can verify it in the Evidence, Trace, Evals, and Stack panels and in the source code.

The existing presentation graphic is at `public/report/notebooklm-comparison.svg`; treat it as assignment positioning, while this document is the precise technical comparison.
