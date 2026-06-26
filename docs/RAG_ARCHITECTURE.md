# RAG Architecture

## Pipeline

1. Upload
   - `app/api/documents/route.ts` receives PDF/TXT/MD files.
   - PDF text is extracted page by page so citations can point back to pages.

2. Chunking
   - `src/lib/chunking.ts` implements page-aware recursive semantic windows.
   - Target size: 720 estimated tokens.
   - Overlap: 90 estimated tokens.
   - Oversized paragraphs are split by sentence windows.
   - Simple headings are carried into chunk metadata.

3. Embedding
   - `src/lib/openrouter.ts` calls OpenRouter `/embeddings`.
   - Default model: `openai/text-embedding-3-small`.

4. Storage
   - `src/lib/qdrant.ts` creates or reuses a Qdrant collection.
   - Each point stores the vector and payload: document ID, page, chunk index, heading, text, and token estimate.

5. Retrieval
   - Dense search: Qdrant vector search filtered by document ID.
   - Lexical search: BM25 over the document chunks.
   - Fusion: 68 percent dense score and 32 percent BM25 score.
   - Selection: MMR removes redundant chunks before generation.

6. Generation
   - `src/lib/rag.ts` passes selected chunks to OpenRouter chat completions.
   - The system prompt requires source-only answers and citations.

## Why This Is Stronger Than a Basic Demo

The sample assignment code indexes full PDF loader documents directly and retrieves only three chunks. AtlasLM adds chunking control, hybrid retrieval, citations, source inspection, strict refusal behavior, deployment-friendly Qdrant Cloud support, and measurable vector memory estimates.
