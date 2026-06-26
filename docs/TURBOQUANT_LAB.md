# TurboQuant Research Lane

Google's TurboQuant work targets extreme vector compression so retrieval indexes use much less memory. That is valuable for large-scale RAG, but it is not a direct replacement for a deployable vector database requirement in this assignment.

AtlasLM handles this honestly:

- Production path: Qdrant stores and retrieves vectors for the live app.
- UI metric: upload results estimate FP32 vector memory versus 4-bit compressed storage.
- Lab path: `scripts/turbovec_lab.py` shows how exported embeddings could be tested with open-source TurboQuant-inspired tooling.

## Suggested Internship Talking Point

"I used Qdrant for the production vector database because the assignment requires a deployable app. I also studied TurboQuant-style compression and added a lab path for benchmarking memory-reduced vector indexes. This separates production reliability from research experimentation."

## Lab Usage

```bash
python -m venv .venv
.venv\Scripts\activate
pip install numpy turbovec
python scripts/turbovec_lab.py
```

If `turbovec` changes its API, keep the lab script as a documented experiment and do not block the main Qdrant deployment on it.
