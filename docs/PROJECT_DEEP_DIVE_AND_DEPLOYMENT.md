# AtlasLM Project Deep Dive And Deployment

This document has moved to [RESEARCH_AND_INTERVIEW_GUIDE.md](RESEARCH_AND_INTERVIEW_GUIDE.md).

The new guide reflects the current implementation: contextual 640-token chunks, BM25 + dense Reciprocal Rank Fusion, two reranking modes, evidence sufficiency, citation auditing, semantic caching, tracing, continuous evals, and real Qdrant 1.18 TurboQuant.

Quick local start:

```powershell
docker compose up --build
```

Then open `http://localhost:3002`.
