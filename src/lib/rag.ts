import { embedTexts, generateGroundedAnswer } from "./openrouter";
import { ensureCollection, scrollDocumentChunks, searchDenseChunks, upsertChunks } from "./qdrant";
import { bm25Scores, mmrSelect, normalizeScores } from "./scoring";
import type { CitationSource, DocumentChunk, SearchCandidate, UploadedDocumentSummary } from "./types";
import { DEFAULT_CHUNK_STRATEGY } from "./chunking";

function roundKb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

export async function indexChunks({
  documentId,
  name,
  mimeType,
  pageCount,
  chunks
}: {
  documentId: string;
  name: string;
  mimeType: string;
  pageCount: number;
  chunks: DocumentChunk[];
}): Promise<UploadedDocumentSummary> {
  if (chunks.length === 0) throw new Error("No readable text chunks were found in this file.");

  const vectors = await embedTexts(chunks.map((chunk) => chunk.text));
  const vectorDimensions = vectors[0]?.length ?? 0;
  await ensureCollection(vectorDimensions);
  await upsertChunks(chunks, vectors);

  const fp32Bytes = chunks.length * vectorDimensions * 4;
  const turboQuant4BitBytes = chunks.length * vectorDimensions * 0.5 + chunks.length * 32;

  return {
    id: documentId,
    name,
    mimeType,
    pageCount,
    chunkCount: chunks.length,
    vectorDimensions,
    chunkStrategy: DEFAULT_CHUNK_STRATEGY,
    memoryEstimate: {
      fp32Kb: roundKb(fp32Bytes),
      turboQuant4BitKb: roundKb(turboQuant4BitBytes),
      reductionRatio: Math.round((fp32Bytes / Math.max(1, turboQuant4BitBytes)) * 10) / 10
    }
  };
}

function mergeCandidates({
  dense,
  allChunks,
  lexicalScores
}: {
  dense: Array<DocumentChunk & { vectorScore: number }>;
  allChunks: DocumentChunk[];
  lexicalScores: Map<string, number>;
}): SearchCandidate[] {
  const denseIds = new Set(dense.map((chunk) => chunk.id));
  const lexicalTop = [...allChunks]
    .sort((a, b) => (lexicalScores.get(b.id) ?? 0) - (lexicalScores.get(a.id) ?? 0))
    .slice(0, 24);

  const byId = new Map<string, DocumentChunk & { vectorScore?: number }>();
  for (const chunk of dense) byId.set(chunk.id, chunk);
  for (const chunk of lexicalTop) {
    if (!byId.has(chunk.id)) byId.set(chunk.id, { ...chunk, vectorScore: 0 });
  }

  const candidates = [...byId.values()];
  const vectorNormalized = normalizeScores(candidates, (chunk) => chunk.vectorScore ?? 0);
  const lexicalNormalized = normalizeScores(candidates, (chunk) => lexicalScores.get(chunk.id) ?? 0);

  return candidates
    .map((chunk) => {
      const vectorScore = denseIds.has(chunk.id) ? vectorNormalized.get(chunk.id) ?? 0 : 0;
      const lexicalScore = lexicalNormalized.get(chunk.id) ?? 0;
      return {
        ...chunk,
        vectorScore,
        lexicalScore,
        hybridScore: 0.68 * vectorScore + 0.32 * lexicalScore
      };
    })
    .filter((candidate) => candidate.text.trim().length > 0)
    .sort((a, b) => b.hybridScore - a.hybridScore);
}

function toCitationSources(candidates: SearchCandidate[]): CitationSource[] {
  return candidates.map((candidate, index) => ({
    citation: `[S${index + 1}]`,
    id: candidate.id,
    sourceName: candidate.sourceName,
    pageNumber: candidate.pageNumber,
    chunkIndex: candidate.chunkIndex,
    heading: candidate.heading,
    text: candidate.text,
    vectorScore: Number(candidate.vectorScore.toFixed(3)),
    lexicalScore: Number(candidate.lexicalScore.toFixed(3)),
    hybridScore: Number(candidate.hybridScore.toFixed(3))
  }));
}

export async function answerQuestion({
  documentId,
  question,
  topK = 6,
  strictMode = true
}: {
  documentId: string;
  question: string;
  topK?: number;
  strictMode?: boolean;
}) {
  const [queryVector] = await embedTexts([question]);
  const [dense, allChunks] = await Promise.all([
    searchDenseChunks(documentId, queryVector, Math.max(16, topK * 4)),
    scrollDocumentChunks(documentId)
  ]);

  if (allChunks.length === 0) {
    throw new Error("No chunks were found for this document. Upload it again or check the Qdrant collection.");
  }

  const lexicalScores = bm25Scores(question, allChunks);
  const candidates = mergeCandidates({ dense, allChunks, lexicalScores });
  const selected = mmrSelect(candidates, topK);
  const sources = toCitationSources(selected);
  const answer = await generateGroundedAnswer({ question, sources, strictMode });

  return {
    answer,
    sources,
    retrieval: {
      denseCandidates: dense.length,
      lexicalCorpus: allChunks.length,
      selectedSources: sources.length
    }
  };
}
