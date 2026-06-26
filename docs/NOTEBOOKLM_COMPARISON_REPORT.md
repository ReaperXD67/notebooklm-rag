# AtlasLM vs NotebookLM Report

## Positioning

NotebookLM is excellent for end users, but it is a closed product. AtlasLM is built for evaluators who need to see the retrieval pipeline and code quality.

## Comparison

| Area | NotebookLM | AtlasLM |
| --- | --- | --- |
| Retrieval visibility | Hidden | Shows chunks, pages, and scores |
| Vector DB control | Closed | Qdrant collection with payload filters |
| Chunking strategy | Hidden | Documented page-aware recursive windows |
| Grounding | Product-level citations | Prompt rules plus visible retrieved evidence |
| Deployment | Google product | Your public GitHub and live Vercel app |
| Research extensibility | Closed | TurboQuant lab and memory estimates |

## Why Prefer AtlasLM For This Assignment

AtlasLM proves the complete RAG pipeline instead of only demonstrating a chat UI. The evaluator can inspect ingestion, chunking, embedding, storage, retrieval, generation, and citation behavior directly in the repository.

The comparison visual is available at:

`public/report/notebooklm-comparison.svg`
