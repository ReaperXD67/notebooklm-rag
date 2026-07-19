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

async function qdrantFetch(path: string, init: RequestInit = {}, traceId?: string) {
  const response = await fetch(qdrantUrl(path), {
    ...init,
    headers: {
      ...qdrantHeaders(),
      ...(traceId ? { "x-tracing-id": traceId } : {}),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qdrant request failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function ensurePayloadIndex(fieldName: string, fieldSchema: "keyword" | "integer"): Promise<void> {
  const response = await fetch(qdrantUrl(`/collections/${COLLECTION}/index`), {
    method: "PUT",
    headers: qdrantHeaders(),
    body: JSON.stringify({
      field_name: fieldName,
      field_schema: fieldSchema
    })
  });

  if (response.ok) return;

  const text = await response.text();
  if (response.status === 400 && /already|exists/i.test(text)) return;
  throw new Error(`Qdrant payload index setup failed (${response.status}): ${text}`);
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

const turboQuantConfig = {
  turbo: {
    bits: "bits4",
    always_ram: true
  }
};

function turboQuantEnabled(): boolean {
  return process.env.QDRANT_TURBOQUANT !== "false";
}

async function createCollection(vectorSize: number, traceId?: string): Promise<boolean> {
  const baseConfig = {
    vectors: {
      size: vectorSize,
      distance: "Cosine"
    },
    hnsw_config: {
      m: 16,
      ef_construct: 128
    },
    metadata: {
      application: "AtlasLM",
      retrieval: "contextual-hybrid-rrf"
    }
  };
  const wantsTurbo = turboQuantEnabled();
  const response = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    method: "PUT",
    headers: {
      ...qdrantHeaders(),
      ...(traceId ? { "x-tracing-id": traceId } : {})
    },
    body: JSON.stringify({
      ...baseConfig,
      ...(wantsTurbo ? { quantization_config: turboQuantConfig } : {})
    })
  });

  if (response.ok) return wantsTurbo;
  const text = await response.text();
  const unsupportedTurbo =
    wantsTurbo && [400, 422].includes(response.status) && /turbo|quantization|variant|unknown/i.test(text);
  if (!unsupportedTurbo) {
    throw new Error(`Qdrant collection creation failed (${response.status}): ${text}`);
  }

  await qdrantFetch(`/collections/${COLLECTION}`, {
    method: "PUT",
    body: JSON.stringify(baseConfig)
  }, traceId);
  return false;
}

async function enableTurboQuant(traceId?: string): Promise<boolean> {
  if (!turboQuantEnabled()) return false;
  try {
    await qdrantFetch(`/collections/${COLLECTION}`, {
      method: "PATCH",
      body: JSON.stringify({ quantization_config: turboQuantConfig })
    }, traceId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/400|404|422|turbo|quantization|variant|unknown/i.test(message)) return false;
    throw error;
  }
}

export async function ensureCollection(
  vectorSize: number,
  traceId?: string
): Promise<{ quantizationAvailable: boolean }> {
  const response = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    headers: {
      ...qdrantHeaders(),
      ...(traceId ? { "x-tracing-id": traceId } : {})
    }
  });

  if (response.status === 404) {
    const quantizationAvailable = await createCollection(vectorSize, traceId);
    await ensurePayloadIndex("documentId", "keyword");
    await ensurePayloadIndex("contentHash", "keyword");
    return { quantizationAvailable };
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

  const existingQuantization = json.result?.config?.quantization_config;
  const quantizationAvailable = existingQuantization?.turbo ? true : await enableTurboQuant(traceId);
  await ensurePayloadIndex("documentId", "keyword");
  await ensurePayloadIndex("contentHash", "keyword");
  return { quantizationAvailable };
}

export async function upsertChunks(chunks: DocumentChunk[], vectors: number[][], traceId?: string): Promise<void> {
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
      retrievalText: chunk.retrievalText,
      tokenEstimate: chunk.tokenEstimate,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      contentHash: chunk.contentHash
    }
  }));

  await qdrantFetch(`/collections/${COLLECTION}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points })
  }, traceId);
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
    retrievalText: String(payload.retrievalText ?? payload.text ?? ""),
    tokenEstimate: Number(payload.tokenEstimate ?? 0),
    charStart: Number(payload.charStart ?? 0),
    charEnd: Number(payload.charEnd ?? 0),
    contentHash: String(payload.contentHash ?? "")
  };
}

export async function searchDenseChunks(
  documentId: string,
  vector: number[],
  limit: number,
  traceId?: string
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
        exact: false,
        quantization: {
          ignore: false,
          rescore: true,
          oversampling: 1.5
        }
      }
    })
  }, traceId);

  return (json.result ?? []).map((point: QdrantPoint) => ({
    ...pointToChunk(point, documentId),
    vectorScore: Number(point.score ?? 0)
  }));
}

export async function scrollDocumentChunks(
  documentId: string,
  maxChunks = 1200,
  traceId?: string
): Promise<DocumentChunk[]> {
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
    }, traceId);

    const points = json.result?.points ?? [];
    chunks.push(...points.map((point: QdrantPoint) => pointToChunk(point, documentId)));
    offset = json.result?.next_page_offset;
    if (!offset || points.length === 0) break;
  }

  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}
