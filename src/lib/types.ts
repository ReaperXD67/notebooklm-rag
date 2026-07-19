export type SourcePage = {
  pageNumber: number;
  text: string;
};

export type ChunkStrategy = {
  name: string;
  targetTokens: number;
  overlapTokens: number;
  description: string;
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  sourceName: string;
  pageNumber: number;
  heading?: string;
  text: string;
  retrievalText: string;
  tokenEstimate: number;
  charStart: number;
  charEnd: number;
  contentHash: string;
};

export type EmbeddedChunk = DocumentChunk & {
  vector: number[];
};

export type SearchCandidate = DocumentChunk & {
  rawVectorScore: number;
  vectorScore: number;
  lexicalScore: number;
  rrfScore: number;
  hybridScore: number;
  rerankScore: number;
  rerankReason?: string;
  originalRank: number;
};

export type CitationSource = {
  citation: string;
  id: string;
  sourceName: string;
  pageNumber: number;
  chunkIndex: number;
  heading?: string;
  text: string;
  rawVectorScore: number;
  vectorScore: number;
  lexicalScore: number;
  rrfScore: number;
  hybridScore: number;
  rerankScore: number;
  originalRank: number;
  finalRank: number;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type RetrievalMode = "efficient" | "precision";

export type EvidenceAssessment = {
  status: "sufficient" | "limited" | "insufficient";
  confidence: number;
  retrievalStrength: number;
  queryCoverage: number;
  sourceAgreement: number;
  llmSufficiency?: boolean;
  reason: string;
  missingEvidence?: string;
};

export type CitationAudit = {
  valid: boolean;
  coverage: number;
  citedClaims: number;
  totalClaims: number;
  usedCitations: string[];
  invalidCitations: string[];
};

export type TraceSpan = {
  name: string;
  label: string;
  durationMs: number;
  status: "ok" | "skipped" | "error";
  detail?: string;
};

export type RagTrace = {
  traceId: string;
  totalMs: number;
  cacheHit: boolean;
  retrievalQuery: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  spans: TraceSpan[];
};

export type GroundingEvaluation = {
  passed: boolean;
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    value: string;
  }>;
};

export type RagAnswerResponse = {
  answer: string;
  sources: CitationSource[];
  evidence: EvidenceAssessment;
  citationAudit: CitationAudit;
  evaluation: GroundingEvaluation;
  abstained: boolean;
  retrieval: {
    mode: RetrievalMode;
    denseCandidates: number;
    lexicalCorpus: number;
    fusedCandidates: number;
    rerankedCandidates: number;
    selectedSources: number;
    reranker: "feature" | "llm-listwise";
  };
  trace: RagTrace;
};

export type UploadedDocumentSummary = {
  id: string;
  name: string;
  mimeType: string;
  pageCount: number;
  chunkCount: number;
  duplicateChunksRemoved: number;
  vectorDimensions: number;
  contentFingerprint: string;
  indexingMs: number;
  chunkStrategy: ChunkStrategy;
  vectorIndex: {
    provider: "Qdrant";
    quantization: "turboquant-4bit" | "uncompressed";
    quantizationAvailable: boolean;
  };
  memoryEstimate: {
    fp32Kb: number;
    turboQuant4BitKb: number;
    reductionRatio: number;
  };
};
