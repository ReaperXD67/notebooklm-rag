# TurboQuant In AtlasLM

TurboQuant is no longer only a side experiment in this project. Qdrant 1.18 implements the Google-inspired quantization pipeline, and AtlasLM enables it in its production collection when the server supports it.

## Production Path

`src/lib/qdrant.ts` requests 4-bit TurboQuant during collection creation:

```json
{
  "quantization_config": {
    "turbo": {
      "bits": "bits4",
      "always_ram": true
    }
  }
}
```

AtlasLM then searches quantized candidates with oversampling and rescoring against original vectors. This balances compressed first-stage retrieval with higher-fidelity final scoring.

The Docker stack pins `qdrant/qdrant:v1.18.0`. If a cloud cluster is older or rejects the TurboQuant schema, collection creation retries without quantization and reports `uncompressed` to the UI. It never displays TurboQuant as active unless Qdrant accepted the configuration.

## Memory Metric

The upload summary compares raw FP32 vector bytes with an explanatory 4-bit estimate. The estimate is useful for scale intuition but is not the database's exact process RSS; payloads, HNSW edges, allocator overhead, and retained original vectors also consume memory. Production memory should be read from Qdrant monitoring.

## Optional Python Lab

`scripts/turbovec_lab.py` remains an isolated experiment for comparing exported vectors with third-party tooling:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install numpy turbovec
python scripts/turbovec_lab.py
```

The lab is optional and never blocks the application.

## Interview Talking Point

> I first treated TurboQuant as a research lane, then upgraded the production database to Qdrant 1.18 when native support became available. I capability-negotiate it, retain original vectors for rescoring, and expose actual activation in the UI. I also avoid claiming universal quality gains because quantization recall must be measured on the target corpus.

Sources: [Google Research](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/), [Qdrant 1.18](https://qdrant.tech/blog/qdrant-1.18.x/), and [independent reproducibility analysis](https://arxiv.org/abs/2604.19528).
