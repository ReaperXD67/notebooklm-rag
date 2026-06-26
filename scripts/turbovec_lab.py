"""
Optional research lab for TurboQuant-style vector compression.

The live AtlasLM app uses Qdrant because the assignment asks for a vector
database and a deployable public project. This script is intentionally separate:
use it to benchmark compressed vector indexes after exporting embeddings.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np


def synthetic_embeddings(rows: int = 512, dims: int = 1536) -> np.ndarray:
    rng = np.random.default_rng(42)
    vectors = rng.normal(size=(rows, dims)).astype("float32")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.maximum(norms, 1e-9)


def memory_report(vectors: np.ndarray) -> None:
    fp32_bytes = vectors.size * 4
    four_bit_bytes = math.ceil(vectors.size / 2)
    print(f"vectors: {vectors.shape[0]} x {vectors.shape[1]}")
    print(f"fp32 memory: {fp32_bytes / 1024 / 1024:.2f} MB")
    print(f"4-bit estimate: {four_bit_bytes / 1024 / 1024:.2f} MB")
    print(f"estimated reduction: {fp32_bytes / max(1, four_bit_bytes):.1f}x")


def main() -> None:
    vectors = synthetic_embeddings()
    memory_report(vectors)

    try:
        import turbovec  # type: ignore
    except ImportError:
        print("turbovec is not installed. Run: pip install turbovec")
        return

    print(f"turbovec module loaded from: {Path(turbovec.__file__).as_posix()}")
    print("Use this hook to build a compressed index with the current turbovec API.")


if __name__ == "__main__":
    main()
