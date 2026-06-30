# AtlasLM RAG

AtlasLM is a deployable Google NotebookLM-style RAG app for Assignment 03. It lets a user upload a PDF, TXT, or Markdown file, indexes the content into Qdrant, and answers questions only from retrieved document chunks.

## What It Implements

- Ingestion: PDF and plain text upload through a Next.js API route.
- Chunking: page-aware recursive semantic windows with overlap and heading carry-forward.
- Embeddings: OpenRouter embeddings, defaulting to `openai/text-embedding-3-small`.
- Vector database: Qdrant Cloud or local Qdrant.
- Retrieval: dense vector search + BM25 keyword scoring + MMR diversity selection.
- Generation: OpenRouter chat model with strict source-grounded prompt and citations.
- Evidence UI: every answer shows the chunks, pages, and hybrid scores used.
- Research lane: TurboQuant memory estimates plus an optional `turbovec` lab script.

## Interview And Deployment Guide

Read `docs/PROJECT_DEEP_DIVE_AND_DEPLOYMENT.md` for the detailed architecture explanation, interviewer talking points, local testing steps, deployment steps, and final submission checklist.

## Best OpenRouter Models

Use these defaults first:

- Generation: `google/gemini-2.5-flash`
- Embeddings: `openai/text-embedding-3-small`

Why: Gemini Flash is fast and cost-efficient for grounded answers, while OpenAI's small embedding model is cheap and strong enough for course-scale retrieval. For a premium demo, switch generation to a stronger reasoning model on OpenRouter and keep the same retrieval stack.

## Local Setup

```bash
npm install
copy .env.example .env.local
```

Run Qdrant locally:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

For local Qdrant, set:

```bash
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
```

Start the app:

```bash
npm run dev
```

## Live Deployment

Recommended public setup:

1. Create a public GitHub repository and push this folder.
2. Create a free Qdrant Cloud cluster.
3. Deploy the repository on Vercel.
4. Add these environment variables in Vercel:
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL`
   - `OPENROUTER_EMBEDDING_MODEL`
   - `QDRANT_URL`
   - `QDRANT_API_KEY`
   - `QDRANT_COLLECTION`
   - `APP_URL`

The live project link must point to the Vercel deployment, not localhost.

## Grounding Policy

The answer prompt explicitly forbids general-knowledge answers. If retrieved chunks do not contain the needed evidence, the assistant must say what is missing. The UI also exposes the source chunks, so hallucinations are easier to catch during evaluation.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## TurboQuant Note

Google's TurboQuant research is about aggressive vector compression. The production app uses Qdrant because the assignment requires a vector database and a public deployment path. The app still shows an estimated FP32 versus 4-bit memory reduction and includes `scripts/turbovec_lab.py` for a research-mode experiment using open-source TurboQuant-inspired tooling.
