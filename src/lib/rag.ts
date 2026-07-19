import { randomUUID } from "node:crypto";
import { DEFAULT_CHUNK_STRATEGY } from "./chunking";
import { findSemanticCache, storeSemanticCache } from "./cache";
import { evaluateGrounding } from "./evaluation";
import {
  abstentionAnswer,
  assessEvidence,
  auditCitations,
  buildRetrievalQuery,
  type LlmSufficiency
} from "./grounding";
import {
  embedTexts,
  generateGroundedAnswer,
  generationModelName,
  rerankWithLlm
} from "./openrouter";
import { ensureCollection, scrollDocumentChunks, searchDenseChunks, upsertChunks } from "./qdrant";
import { bm25Scores, featureRerank, mmrSelect, reciprocalRankFusion } from "./scoring";
import { TraceRecorder } from "./tracing";
import type {
  ChatTurn,
  CitationSource,
  DocumentChunk,
  RagAnswerResponse,
  RetrievalMode,
  SearchCandidate,
  UploadedDocumentSummary
} from "./types";

function roundKb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

export async function indexChunks({
  documentId,
  contentFingerprint,
  duplicateChunksRemoved,
  name,
  mimeType,
  pageCount,
  chunks
}: {
  documentId: string;
  contentFingerprint: string;
  duplicateChunksRemoved: number;
  name: string;
  mimeType: string;
  pageCount: number;
  chunks: DocumentChunk[];
}): Promise<UploadedDocumentSummary> {
  if (chunks.length === 0) throw new Error("No readable text chunks were found in this file.");

  const startedAt = performance.now();
  const traceId = randomUUID();
  const vectors = await embedTexts(chunks.map((chunk) => chunk.retrievalText));
  const vectorDimensions = vectors[0]?.length ?? 0;
  const { quantizationAvailable } = await ensureCollection(vectorDimensions, traceId);
  await upsertChunks(chunks, vectors, traceId);

  const fp32Bytes = chunks.length * vectorDimensions * 4;
  const turboQuant4BitBytes = chunks.length * vectorDimensions * 0.5 + chunks.length * 32;

  return {
    id: documentId,
    name,
    mimeType,
    pageCount,
    chunkCount: chunks.length,
    duplicateChunksRemoved,
    vectorDimensions,
    contentFingerprint: contentFingerprint.slice(0, 12),
    indexingMs: Number((performance.now() - startedAt).toFixed(1)),
    chunkStrategy: DEFAULT_CHUNK_STRATEGY,
    vectorIndex: {
      provider: "Qdrant",
      quantization: quantizationAvailable ? "turboquant-4bit" : "uncompressed",
      quantizationAvailable
    },
    memoryEstimate: {
      fp32Kb: roundKb(fp32Bytes),
      turboQuant4BitKb: roundKb(turboQuant4BitBytes),
      reductionRatio: Math.round((fp32Bytes / Math.max(1, turboQuant4BitBytes)) * 10) / 10
    }
  };
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
    rawVectorScore: Number(candidate.rawVectorScore.toFixed(3)),
    vectorScore: Number(candidate.vectorScore.toFixed(3)),
    lexicalScore: Number(candidate.lexicalScore.toFixed(3)),
    rrfScore: Number(candidate.rrfScore.toFixed(3)),
    hybridScore: Number(candidate.hybridScore.toFixed(3)),
    rerankScore: Number(candidate.rerankScore.toFixed(3)),
    originalRank: candidate.originalRank,
    finalRank: index + 1
  }));
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown reranker failure";
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

export async function answerQuestion({
  documentId,
  question,
  topK = 6,
  strictMode = true,
  mode = "efficient",
  history = []
}: {
  documentId: string;
  question: string;
  topK?: number;
  strictMode?: boolean;
  mode?: RetrievalMode;
  history?: ChatTurn[];
}): Promise<RagAnswerResponse> {
  const retrievalQuery = buildRetrievalQuery(question, history);
  const trace = new TraceRecorder(retrievalQuery, generationModelName());

  const endEmbedding = trace.start("query_embedding", "Query embedding");
  const [queryVector] = await embedTexts([retrievalQuery]);
  endEmbedding("ok", `${queryVector.length} dimensions`);

  const cached = findSemanticCache({ documentId, queryVector, mode, strictMode, topK });
  if (cached) {
    trace.markCacheHit();
    trace.skip("retrieval", "Hybrid retrieval", "Semantic cache hit");
    trace.skip("generation", "Grounded generation", "Reused audited response");
    const cachedTrace = trace.finish();
    const evaluation = evaluateGrounding({
      audit: cached.citationAudit,
      evidence: cached.evidence,
      abstained: cached.abstained,
      trace: cachedTrace
    });
    return { ...cached, trace: cachedTrace, evaluation };
  }

  const endDense = trace.start("dense_retrieval", "Qdrant ANN search");
  const endCorpus = trace.start("lexical_corpus", "Document corpus scan");
  const densePromise = searchDenseChunks(documentId, queryVector, Math.max(24, topK * 5), trace.traceId)
    .then((result) => {
      endDense("ok", `${result.length} candidates`);
      return result;
    })
    .catch((error) => {
      endDense("error", errorDetail(error));
      throw error;
    });
  const corpusPromise = scrollDocumentChunks(documentId, 1200, trace.traceId)
    .then((result) => {
      endCorpus("ok", `${result.length} chunks`);
      return result;
    })
    .catch((error) => {
      endCorpus("error", errorDetail(error));
      throw error;
    });
  const [dense, allChunks] = await Promise.all([densePromise, corpusPromise]);

  if (allChunks.length === 0) {
    throw new Error("No chunks were found for this document. Upload it again or check the Qdrant collection.");
  }

  const endFusion = trace.start("hybrid_fusion", "BM25 + reciprocal rank fusion");
  const lexicalScores = bm25Scores(retrievalQuery, allChunks);
  const fused = reciprocalRankFusion({ dense, allChunks, lexicalScores, candidateLimit: Math.max(32, topK * 6) });
  let reranked = featureRerank(retrievalQuery, fused);
  endFusion("ok", `${fused.length} fused candidates`);

  let reranker: "feature" | "llm-listwise" = "feature";
  let llmSufficiency: LlmSufficiency | undefined;
  if (mode === "precision") {
    const endRerank = trace.start("precision_rerank", "LLM listwise reranker");
    try {
      const result = await rerankWithLlm({ question: retrievalQuery, candidates: reranked });
      reranked = result.candidates;
      llmSufficiency = result.sufficiency;
      reranker = "llm-listwise";
      endRerank("ok", `Top ${Math.min(14, fused.length)} judged together`);
    } catch (error) {
      endRerank("error", `${errorDetail(error)}; feature fallback used`);
    }
  } else {
    trace.skip("precision_rerank", "LLM listwise reranker", "Efficient mode uses feature reranking");
  }

  const endSelection = trace.start("evidence_selection", "MMR evidence selection");
  const selected = mmrSelect(reranked, topK);
  const sources = toCitationSources(selected);
  endSelection("ok", `${sources.length} diverse passages`);

  const endSufficiency = trace.start("sufficiency", "Evidence sufficiency gate");
  const evidence = assessEvidence(retrievalQuery, selected, llmSufficiency);
  endSufficiency("ok", `${evidence.status}; ${Math.round(evidence.confidence * 100)}% confidence`);

  let answer: string;
  let abstained = strictMode && evidence.status === "insufficient";
  if (abstained) {
    answer = abstentionAnswer(evidence);
    trace.skip("generation", "Grounded generation", "Blocked before generation by evidence gate");
  } else {
    const endGeneration = trace.start("generation", "Grounded answer generation");
    const generation = await generateGroundedAnswer({ question, sources, strictMode, history });
    answer = generation.content;
    trace.setUsage(generation.promptTokens, generation.completionTokens);
    endGeneration("ok", `${generation.completionTokens ?? "unknown"} output tokens`);
  }

  const endAudit = trace.start("citation_audit", "Citation integrity audit");
  let citationAudit = auditCitations(answer, sources);
  if (strictMode && !abstained && !citationAudit.valid) {
    abstained = true;
    answer = "I cannot return the drafted answer because its citations did not pass the grounding audit.";
    citationAudit = auditCitations(answer, sources);
    endAudit("error", "Draft blocked because citation coverage was below the strict threshold");
  } else {
    endAudit("ok", `${Math.round(citationAudit.coverage * 100)}% claim coverage`);
  }

  const finishedTrace = trace.finish();
  const evaluation = evaluateGrounding({ audit: citationAudit, evidence, abstained, trace: finishedTrace });
  const response: RagAnswerResponse = {
    answer,
    sources,
    evidence,
    citationAudit,
    evaluation,
    abstained,
    retrieval: {
      mode,
      denseCandidates: dense.length,
      lexicalCorpus: allChunks.length,
      fusedCandidates: fused.length,
      rerankedCandidates: reranked.length,
      selectedSources: sources.length,
      reranker
    },
    trace: finishedTrace
  };

  storeSemanticCache({ documentId, queryVector, mode, strictMode, topK, response });
  return response;
}
