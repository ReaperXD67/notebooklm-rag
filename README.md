# AtlasLM

AtlasLM is an evidence-first document intelligence workbench built for Assignment 03. Upload an unseen PDF, TXT, or Markdown document, ask questions, and inspect not only the answer but the retrieval evidence, confidence, citations, evaluation checks, and execution trace behind it.

This is not a three-chunk vector-search demo. It implements a cost-aware, inspectable RAG pipeline with a real Qdrant 1.18 TurboQuant index.

Its live Corpus Field turns chunks and retrieved passages into an animated, interactive evidence topology. Query packets, active citations, and source links are visual system state rather than decorative animation.

## Production Checklist

| Requirement | AtlasLM implementation |
| --- | --- |
| Ingest + normalize | PDF line reconstruction, repeated-margin removal, metadata, content fingerprints, deterministic chunk IDs, exact deduplication |
| Hybrid retrieval | Qdrant dense ANN + local BM25, fused with Reciprocal Rank Fusion (RRF) |
| ANN + reranking | Wide candidate retrieval, feature reranking, MMR diversity; optional LLM listwise reranker in Precision mode |
| Source confidence | Score agreement, query-term coverage, top-score strength, citation audit, and evidence sufficiency |
| Constrained generation | The model receives retrieved source passages and a source-only prompt with prompt-injection isolation |
| Citation-backed answers | Claims cite inspectable `[S1]` sources with page, heading, retrieval scores, and rank changes |
| Hallucination fallback | Pre-generation sufficiency gate and post-generation citation audit can abstain or block a draft |
| Continuous evals | Unit/eval suite, per-response grounding checks, and a live adversarial missing-fact probe |
| Caching + memory | Conversation-aware retrieval query plus document-scoped semantic answer cache |
| Observability | Per-request trace ID, timed pipeline spans, token use, cache state, and retrieval counters |

## Architecture

```text
Upload -> normalize -> contextual chunks -> dedupe -> embed -> Qdrant TurboQuant
Question -> conversational rewrite -> dense ANN + BM25 -> RRF -> rerank -> MMR
         -> sufficiency gate -> grounded generation -> citation audit -> answer/evidence/trace
```

See [the HLD](docs/HLD_DIAGRAM.md), [pipeline details](docs/RAG_ARCHITECTURE.md), and the [research and interview guide](docs/RESEARCH_AND_INTERVIEW_GUIDE.md).

## Fastest Local Test

Requirements: Docker Desktop and an OpenRouter key.

```powershell
Copy-Item .env.example .env.local
# Put your OPENROUTER_API_KEY in .env.local
docker compose up --build
```

Open [http://localhost:3002](http://localhost:3002). Qdrant runs at `http://localhost:6333` and persists data in a Docker volume.

Stop the stack with:

```powershell
docker compose down
```

## Run Without Docker

Start Qdrant 1.18 separately, set `QDRANT_URL=http://localhost:6333`, then:

```powershell
npm install
npm run dev
```

Next.js defaults to [http://localhost:3000](http://localhost:3000). If that port is occupied, use `npm run dev -- -p 3002`.

## Models And Cost Controls

Defaults are intentionally economical:

- Generation: `google/gemini-2.5-flash-lite`
- Precision reranker/judge: `google/gemini-2.5-flash-lite`
- Embeddings: `openai/text-embedding-3-small`
- Efficient mode: local feature reranking, one answer-generation call
- Precision mode: one additional listwise reranking and sufficiency call
- Semantic cache: reuses an audited answer for a near-identical question in the same document workspace

Do not commit `.env.local`. Rotate any API key that has been pasted into a chat or screenshot.

## Verification

```powershell
npm run quality
npm run eval
```

The quality command runs TypeScript checks, the Vitest suite, and a production Next.js build. GitHub Actions runs the same checks on pushes and pull requests.

## Deployment

1. Push the public repository to GitHub.
2. Create a Qdrant Cloud cluster running Qdrant 1.18 or newer.
3. Import the repository into Vercel.
4. Add the variables from `.env.example` to Vercel.
5. Set `APP_URL` to the deployed HTTPS URL and redeploy.

AtlasLM negotiates TurboQuant support when creating its collection. A Qdrant cluster older than 1.18 falls back to an uncompressed collection instead of making ingestion unusable.

## Honest Scope

AtlasLM currently indexes one uploaded source workspace at a time in the UI. Its cache is instance-local, so a production multi-instance deployment should move it to Redis. It does not claim OCR, audio generation, collaborative notebooks, or full GraphRAG. The focus is high-quality grounded retrieval, abstention, transparency, and a reproducible evaluation surface.
