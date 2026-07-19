import { cosineSimilarity } from "./scoring";
import type { RagAnswerResponse, RetrievalMode } from "./types";

type CacheEntry = {
  documentId: string;
  queryVector: number[];
  mode: RetrievalMode;
  strictMode: boolean;
  topK: number;
  createdAt: number;
  response: RagAnswerResponse;
};

const GLOBAL_CACHE_KEY = "__atlaslmSemanticCache";
const globalCache = globalThis as typeof globalThis & { [GLOBAL_CACHE_KEY]?: CacheEntry[] };
const entries = (globalCache[GLOBAL_CACHE_KEY] ??= []);

function cacheTtlMs(): number {
  const configured = Number(process.env.RAG_CACHE_TTL_SECONDS ?? 900);
  return Math.max(60, Math.min(configured, 3600)) * 1000;
}

function prune() {
  const cutoff = Date.now() - cacheTtlMs();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].createdAt < cutoff) entries.splice(index, 1);
  }
  if (entries.length > 80) entries.splice(0, entries.length - 80);
}

export function findSemanticCache({
  documentId,
  queryVector,
  mode,
  strictMode,
  topK
}: Omit<CacheEntry, "createdAt" | "response">): RagAnswerResponse | null {
  prune();
  const threshold = Number(process.env.RAG_CACHE_SIMILARITY ?? 0.992);
  const match = [...entries]
    .reverse()
    .find(
      (entry) =>
        entry.documentId === documentId &&
        entry.mode === mode &&
        entry.strictMode === strictMode &&
        entry.topK === topK &&
        cosineSimilarity(entry.queryVector, queryVector) >= threshold
    );
  return match ? structuredClone(match.response) : null;
}

export function storeSemanticCache(entry: Omit<CacheEntry, "createdAt">): void {
  prune();
  entries.push({ ...entry, createdAt: Date.now() });
}
