# AtlasLM Project Deep Dive And Deployment Guide

This document is written so you can explain the project confidently to an interviewer, evaluator, or internship mentor. It covers what the app does, why the architecture is stronger than a basic RAG demo, what technologies are used, how to test it locally, and how to deploy it publicly.

## 1. Short Pitch

AtlasLM is a NotebookLM-style document conversation app built from scratch with an inspectable RAG pipeline. A user uploads a PDF or text document, the app chunks the document, embeds those chunks, stores them in Qdrant, retrieves the most relevant evidence for each question, and generates a grounded answer using OpenRouter.

The key difference from a basic chatbot is that answers are not generated from model memory. Every answer is produced from retrieved source chunks, and the UI shows the exact evidence chunks, page numbers, and retrieval scores used for the answer.

## 2. What Makes This Project Strong

Most simple RAG demos do this:

1. Load a PDF.
2. Split it into chunks.
3. Store embeddings.
4. Retrieve top 3 chunks.
5. Ask the LLM to answer.

AtlasLM goes deeper:

1. It keeps page metadata so citations can point back to the source.
2. It uses a documented page-aware chunking strategy instead of blindly indexing full pages.
3. It uses Qdrant as a real vector database, not an in-memory array.
4. It uses hybrid retrieval: dense vector search plus BM25 lexical scoring.
5. It applies MMR selection so the final context is relevant but not repetitive.
6. It has strict grounding rules that tell the model to refuse unsupported answers.
7. It exposes evidence chunks and scores in the frontend, making the system auditable.
8. It includes a TurboQuant research lane to show awareness of modern vector compression work.
9. It is deployable with Vercel, Qdrant Cloud, and OpenRouter.

The result is not only a working RAG application; it is a system you can explain end to end.

## 3. Architecture Overview

The pipeline is:

```text
User upload
  -> PDF/TXT parser
  -> page-aware chunker
  -> OpenRouter embedding model
  -> Qdrant vector database
  -> dense vector retrieval
  -> BM25 lexical retrieval
  -> score fusion
  -> MMR source selection
  -> grounded LLM answer
  -> citations and evidence UI
```

Important files:

| File | Purpose |
| --- | --- |
| `app/api/documents/route.ts` | Handles upload, PDF/TXT parsing, chunking, embedding, and Qdrant indexing |
| `app/api/chat/route.ts` | Handles user questions and returns grounded answers |
| `src/lib/chunking.ts` | Implements the documented chunking strategy |
| `src/lib/qdrant.ts` | Talks to the Qdrant vector database |
| `src/lib/openrouter.ts` | Calls OpenRouter embeddings and chat completions |
| `src/lib/rag.ts` | Connects retrieval, reranking, citation formatting, and generation |
| `src/lib/scoring.ts` | Implements BM25 scoring and MMR source selection |
| `src/components/RagWorkbench.tsx` | Main frontend interface |

## 4. Chunking Strategy

The chunking strategy is called page-aware recursive semantic windows.

It does four things:

1. Preserves page number metadata.
2. Detects simple headings and stores them as chunk metadata.
3. Splits long text into approximately 720-token chunks.
4. Adds around 90 tokens of overlap between chunks.

Why overlap matters:

When documents are split, an important answer may span two adjacent chunks. Overlap reduces the chance that the retriever misses the surrounding context.

Why page awareness matters:

Many RAG demos lose page numbers after chunking. AtlasLM keeps page numbers so the answer can show where evidence came from.

Why not make chunks too large:

Large chunks can include irrelevant text, which weakens retrieval precision. Smaller semantic chunks make search more targeted.

Why not make chunks too small:

Tiny chunks can lose context, definitions, and examples. The 720-token target is a practical balance for course documents, PDFs, and technical notes.

## 5. Embeddings

The default embedding model is:

```text
openai/text-embedding-3-small
```

It is called through OpenRouter.

Embeddings convert text chunks into numerical vectors. These vectors let the app search by meaning, not only by exact words. For example, a question about "debugging crashes" can retrieve text about "stack traces" even if the exact phrase is different.

The model can be changed through:

```text
OPENROUTER_EMBEDDING_MODEL
```

## 6. Vector Database

AtlasLM uses Qdrant.

Qdrant stores:

1. The embedding vector.
2. The document ID.
3. The page number.
4. The chunk index.
5. The chunk text.
6. Optional heading metadata.
7. Token and character estimates.

Why Qdrant:

1. It is a real vector database.
2. It supports filtered search by document ID.
3. It works locally through Docker.
4. It works in production through Qdrant Cloud.
5. It is a strong choice for a public deployed assignment because the Vercel app does not need to store vectors on its own filesystem.

## 7. Retrieval Strategy

AtlasLM does not rely on vector search alone.

It combines:

1. Dense retrieval from Qdrant.
2. BM25 lexical scoring.
3. Hybrid score fusion.
4. MMR diversity selection.

### Dense Retrieval

Dense retrieval finds chunks that are semantically similar to the question.

Example:

```text
Question: How do I debug a Node server?
```

Dense retrieval can find chunks about:

```text
breakpoints, stack traces, inspector, logs, runtime errors
```

even if the exact words differ.

### BM25 Retrieval

BM25 is a traditional keyword-based retrieval algorithm. It is useful when exact terms matter.

Examples:

```text
API names
function names
error codes
specific terms from the PDF
```

This matters because vector search can sometimes miss rare exact terms.

### Hybrid Fusion

AtlasLM blends dense and lexical scores:

```text
hybridScore = 0.68 * denseScore + 0.32 * BM25Score
```

This gives semantic search the bigger role while still rewarding exact matches.

### MMR Selection

MMR means Maximal Marginal Relevance.

It chooses chunks that are relevant but not too repetitive. This helps avoid sending the LLM six chunks that all say the same thing.

This is important because the LLM's answer quality depends heavily on the quality and diversity of the retrieved context.

## 8. Grounded Generation

The final answer is generated through OpenRouter.

Default generation model:

```text
google/gemini-2.5-flash
```

The system prompt tells the model:

1. Answer only from the retrieved source excerpts.
2. Cite factual claims using source labels such as `[S1]`.
3. Say what is missing if evidence is insufficient.
4. Do not use general knowledge.

This is important because a normal LLM can hallucinate. AtlasLM tries to reduce hallucination by forcing the model to answer from retrieved document context.

## 9. Evidence UI

The frontend is designed to make retrieval visible.

For each answer, it shows:

1. Source label.
2. Page number.
3. Chunk text.
4. Hybrid score.
5. Dense vector score.
6. BM25 lexical score.

This makes the app easier to evaluate. If an answer is wrong, you can inspect whether the retriever found bad context or whether the LLM misused good context.

That distinction is important in real RAG debugging.

## 10. Why This Is Better Than A Basic NotebookLM Clone

This project should not claim to be better than Google's full NotebookLM product as a consumer app. That would be unrealistic.

The stronger claim is:

AtlasLM is better for an assignment, portfolio, and interview because the complete RAG pipeline is visible, modifiable, and explainable.

| Area | Basic Clone | AtlasLM |
| --- | --- | --- |
| Chunking | Often hidden or default splitter | Custom documented page-aware chunking |
| Retrieval | Usually top-k vector only | Dense + BM25 + MMR |
| Vector storage | Sometimes memory only | Qdrant vector database |
| Grounding | Prompt says "use context" | Prompt plus citations plus visible evidence |
| Debuggability | Hard to inspect | Scores and chunks shown in UI |
| Deployment | Often local only | Designed for Vercel + Qdrant Cloud |
| Research awareness | Usually none | TurboQuant memory-compression discussion |

## 11. TurboQuant Research Angle

TurboQuant is included as a research discussion, not as the production vector database.

The production app uses Qdrant because:

1. The assignment requires a vector database.
2. Qdrant is deployment friendly.
3. It supports document-level filtering.
4. It is reliable for a live evaluator demo.

The TurboQuant angle is used to show deeper understanding:

1. Large vector indexes can become memory heavy.
2. Float32 vectors store each dimension in 4 bytes.
3. 4-bit quantization can theoretically reduce raw vector storage by about 8x.
4. Lower memory usage can improve cache behavior and retrieval scalability.
5. Compression can introduce accuracy tradeoffs, so it should be benchmarked instead of blindly used.

The app displays an estimated FP32 versus 4-bit vector memory comparison after upload. The separate script `scripts/turbovec_lab.py` is a research hook for experimenting with compressed vector indexes.

Interview line:

```text
I kept Qdrant in production because the assignment needs a real deployable vector database. I still added a TurboQuant-inspired lab path and memory estimate to show how I would think about scaling vector search beyond a classroom demo.
```

## 12. Things To Say In An Interview

Use these points to sound confident and technically deep.

### On RAG Quality

```text
RAG quality is mostly retrieval quality. I did not only prompt the LLM; I improved the retrieval layer with hybrid dense and lexical search, then used MMR to reduce redundant context.
```

### On Hallucination

```text
The model is instructed to answer only from retrieved source chunks, and the UI exposes the evidence. If a question is not supported by the document, strict mode tells the model to say what is missing.
```

### On Chunking

```text
I used page-aware chunking because citations are useless if the app loses source location. I also added overlap because important ideas often cross chunk boundaries.
```

### On Vector Databases

```text
I used Qdrant because it gives me filtered vector search by document ID, works locally with Docker, and has a cloud option for deployment. That makes the same code path usable locally and live.
```

### On Model Choice

```text
I route models through OpenRouter so I can switch generation models without rewriting the app. I used Gemini Flash as the default because it is fast and cost-effective for grounded answers.
```

### On Debugging

```text
The UI shows the retrieved chunks and scores. That helps identify whether a bad answer came from retrieval failure or generation failure.
```

### On Scaling

```text
For larger datasets, I would add background ingestion jobs, streaming responses, document collections, evaluation sets, reranker models, and benchmark compressed vector search inspired by TurboQuant.
```

## 13. What I Need From You To Make It Fully Ready

Do not paste these into GitHub. Send them only in the secure chat when you want me to configure local testing or deployment.

Required:

1. OpenRouter API key.
2. Qdrant Cloud URL.
3. Qdrant API key.

Optional but helpful:

4. Preferred deployed app URL or project name.
5. Vercel access, if you want me to deploy it from this machine.
6. Whether you want the repo to stay named `notebooklm-rag` or be renamed to something more branded like `atlaslm-rag`.

The `.env.local` file should look like:

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
QDRANT_URL=https://your-qdrant-cluster-url
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=atlaslm_chunks
APP_URL=http://localhost:3000
```

For Vercel, use the same values in the Vercel Environment Variables screen, but set:

```bash
APP_URL=https://your-vercel-domain.vercel.app
```

## 14. Local Testing Guide

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Add environment variables

Create:

```text
.env.local
```

Use the variables from section 13.

### Step 3: Start local Qdrant if you are not using Qdrant Cloud

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Then set:

```bash
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
```

### Step 4: Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

If port 3000 is busy, use:

```bash
npm run dev -- -p 3001
```

### Step 5: Test the RAG flow

1. Upload a PDF or TXT file.
2. Wait for indexing to complete.
3. Ask a question directly answerable from the document.
4. Check that the answer includes citations like `[S1]`.
5. Check the evidence panel for source chunks and page numbers.
6. Ask something not present in the document.
7. Confirm strict mode refuses or says the evidence is missing.

## 15. Deployment Guide

Recommended deployment:

```text
GitHub -> Vercel -> Qdrant Cloud -> OpenRouter
```

### Step 1: GitHub

The repo is already public:

```text
https://github.com/ReaperXD67/notebooklm-rag
```

### Step 2: Qdrant Cloud

Create a Qdrant Cloud cluster and copy:

1. Cluster URL.
2. API key.

Use a collection name such as:

```text
atlaslm_chunks
```

The app will create the collection automatically on first upload.

### Step 3: Vercel

1. Go to Vercel.
2. Import the GitHub repository.
3. Framework should auto-detect as Next.js.
4. Add environment variables.
5. Deploy.

Environment variables:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
QDRANT_URL=...
QDRANT_API_KEY=...
QDRANT_COLLECTION=atlaslm_chunks
APP_URL=https://your-vercel-domain.vercel.app
```

### Step 4: Live Smoke Test

After deployment:

1. Open the live URL.
2. Upload a small PDF.
3. Ask a simple question.
4. Confirm an answer appears with citations.
5. Copy the GitHub link and live link for assignment submission.

## 16. What Could Be Added Next

Strong future improvements:

1. Streaming answers.
2. Multi-document notebooks.
3. User accounts and document history.
4. Better PDF layout extraction.
5. Table-aware chunking.
6. Image OCR for scanned PDFs.
7. A reranker model after first-stage retrieval.
8. Automated answer evaluation with golden questions.
9. Background ingestion queue for large files.
10. Persistent document metadata outside Qdrant payloads.
11. Actual compressed vector benchmark with `turbovec`.
12. Exportable study notes, quizzes, and summaries.

## 17. Demo Script

Use this script during presentation:

1. "I built a full RAG pipeline, not just a chat wrapper."
2. "The document is parsed and split into page-aware overlapping chunks."
3. "Chunks are embedded through OpenRouter and stored in Qdrant."
4. "When I ask a question, retrieval combines semantic vector search with BM25 keyword search."
5. "MMR selects diverse evidence so the LLM gets compact, non-repetitive context."
6. "The answer is grounded because the prompt only allows the model to use retrieved chunks."
7. "The frontend shows which chunks were used, including page numbers and scores."
8. "I also added a TurboQuant research note because vector memory becomes important at scale."

## 18. Final Submission Checklist

Before submitting:

1. GitHub repo is public.
2. Live Vercel link works without local setup.
3. OpenRouter key is configured in Vercel.
4. Qdrant Cloud URL and API key are configured in Vercel.
5. A PDF upload works on the live app.
6. A grounded answer appears with citations.
7. The README and docs are visible in the repo.

