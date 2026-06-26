import type { DocumentChunk } from "./types";

type QdrantPoint = {
  id: string | number;
  score?: number;
  payload?: Record<string, unknown>;
};

const COLLECTION = process.env.QDRANT_COLLECTION ?? "atlaslm_chunks";

function qdrantUrl(path: string): string {
  const baseUrl = process.env.QDRANT_URL;
  if (!baseUrl) {
    throw new Error("QDRANT_URL is missing. Use Qdrant Cloud for deployment or run Qdrant locally.");
  }
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function qdrantHeaders() {
  return {
    "Content-Type": "application/json",
    ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {})
  };
}

async function qdrantFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(qdrantUrl(path), {
    ...init,
    headers: {
      ...qdrantHeaders(),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qdrant request failed (${response.status}): ${text}`);
  }

  return response.json();
}

function documentFilter(documentId: string) {
  return {
    must: [
      {
        key: "documentId",
        match: { value: documentId }
      }
    ]
  };
}

export async function ensureCollection(vectorSize: number): Promise<void> {
  const response = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    headers: qdrantHeaders()
  });

  if (response.status === 404) {
    await qdrantFetch(`/collections/${COLLECTION}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: vectorSize,
          distance: "Cosine"
        }
      })
    });
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qdrant collection check failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  const existingSize = json.result?.config?.params?.vectors?.size;
  if (existingSize && existingSize !== vectorSize) {
    throw new Error(
      `Qdrant collection ${COLLECTION} has vector size ${existingSize}, but this embedding model returned ${vectorSize}. Use a new QDRANT_COLLECTION or matching embedding model.`
    );
  }
}

export async function upsertChunks(chunks: DocumentChunk[], vectors: number[][]): Promise<void> {
  const points = chunks.map((chunk, index) => ({
    id: chunk.id,
    vector: vectors[index],
    payload: {
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      sourceName: chunk.sourceName,
      pageNumber: chunk.pageNumber,
      heading: chunk.heading ?? null,
      text: chunk.text,
      tokenEstimate: chunk.tokenEstimate,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd
    }
  }));

  await qdrantFetch(`/collections/${COLLECTION}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points })
  });
}

function pointToChunk(point: QdrantPoint, fallbackDocumentId: string): DocumentChunk {
  const payload = point.payload ?? {};
  return {
    id: String(point.id),
    documentId: String(payload.documentId ?? fallbackDocumentId),
    chunkIndex: Number(payload.chunkIndex ?? 0),
    sourceName: String(payload.sourceName ?? "Uploaded document"),
    pageNumber: Number(payload.pageNumber ?? 1),
    heading: payload.heading ? String(payload.heading) : undefined,
    text: String(payload.text ?? ""),
    tokenEstimate: Number(payload.tokenEstimate ?? 0),
    charStart: Number(payload.charStart ?? 0),
    charEnd: Number(payload.charEnd ?? 0)
  };
}

export async function searchDenseChunks(
  documentId: string,
  vector: number[],
  limit: number
): Promise<Array<DocumentChunk & { vectorScore: number }>> {
  const json = await qdrantFetch(`/collections/${COLLECTION}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector,
      filter: documentFilter(documentId),
      limit,
      with_payload: true,
      with_vector: false,
      params: {
        hnsw_ef: 128,
        exact: false
      }
    })
  });

  return (json.result ?? []).map((point: QdrantPoint) => ({
    ...pointToChunk(point, documentId),
    vectorScore: Number(point.score ?? 0)
  }));
}

export async function scrollDocumentChunks(documentId: string, maxChunks = 1200): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];
  let offset: string | number | undefined;

  while (chunks.length < maxChunks) {
    const json = await qdrantFetch(`/collections/${COLLECTION}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        filter: documentFilter(documentId),
        limit: Math.min(256, maxChunks - chunks.length),
        offset,
        with_payload: true,
        with_vector: false
      })
    });

    const points = json.result?.points ?? [];
    chunks.push(...points.map((point: QdrantPoint) => pointToChunk(point, documentId)));
    offset = json.result?.next_page_offset;
    if (!offset || points.length === 0) break;
  }

  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}
