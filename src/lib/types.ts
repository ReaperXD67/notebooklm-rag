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
  tokenEstimate: number;
  charStart: number;
  charEnd: number;
};

export type EmbeddedChunk = DocumentChunk & {
  vector: number[];
};

export type SearchCandidate = DocumentChunk & {
  vectorScore: number;
  lexicalScore: number;
  hybridScore: number;
};

export type CitationSource = {
  citation: string;
  id: string;
  sourceName: string;
  pageNumber: number;
  chunkIndex: number;
  heading?: string;
  text: string;
  vectorScore: number;
  lexicalScore: number;
  hybridScore: number;
};

export type UploadedDocumentSummary = {
  id: string;
  name: string;
  mimeType: string;
  pageCount: number;
  chunkCount: number;
  vectorDimensions: number;
  chunkStrategy: ChunkStrategy;
  memoryEstimate: {
    fp32Kb: number;
    turboQuant4BitKb: number;
    reductionRatio: number;
  };
};
