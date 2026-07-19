import type { DocumentChunk, SearchCandidate } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "with"
]);

export function tokenize(input: string): string[] {
  return (
    input
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9-]{1,}/g)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? []
  );
}

export function bm25Scores(query: string, chunks: DocumentChunk[]): Map<string, number> {
  const queryTerms = [...new Set(tokenize(query))];
  const chunkTerms = chunks.map((chunk) => tokenize(`${chunk.heading ?? ""} ${chunk.retrievalText}`));
  const avgLength =
    chunkTerms.reduce((total, terms) => total + terms.length, 0) / Math.max(1, chunkTerms.length);
  const documentFrequency = new Map<string, number>();

  for (const terms of chunkTerms) {
    for (const term of new Set(terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const scores = new Map<string, number>();
  const k1 = 1.35;
  const b = 0.72;
  const totalDocs = Math.max(1, chunks.length);

  chunks.forEach((chunk, index) => {
    const terms = chunkTerms[index];
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const frequency = frequencies.get(term) ?? 0;
      if (frequency === 0) continue;
      const docsWithTerm = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
      const numerator = frequency * (k1 + 1);
      const denominator = frequency + k1 * (1 - b + b * (terms.length / Math.max(1, avgLength)));
      score += idf * (numerator / denominator);
    }
    scores.set(chunk.id, score);
  });

  return scores;
}

export function reciprocalRankFusion({
  dense,
  allChunks,
  lexicalScores,
  candidateLimit = 32,
  rankConstant = 60
}: {
  dense: Array<DocumentChunk & { vectorScore: number }>;
  allChunks: DocumentChunk[];
  lexicalScores: Map<string, number>;
  candidateLimit?: number;
  rankConstant?: number;
}): SearchCandidate[] {
  const denseRanking = [...dense].sort((a, b) => b.vectorScore - a.vectorScore).slice(0, candidateLimit);
  const lexicalRanking = [...allChunks]
    .sort((a, b) => (lexicalScores.get(b.id) ?? 0) - (lexicalScores.get(a.id) ?? 0))
    .slice(0, candidateLimit);
  const denseRank = new Map(denseRanking.map((chunk, index) => [chunk.id, index + 1]));
  const lexicalRank = new Map(lexicalRanking.map((chunk, index) => [chunk.id, index + 1]));
  const denseById = new Map(denseRanking.map((chunk) => [chunk.id, chunk]));
  const byId = new Map<string, DocumentChunk>();

  for (const chunk of denseRanking) byId.set(chunk.id, chunk);
  for (const chunk of lexicalRanking) byId.set(chunk.id, chunk);

  const union = [...byId.values()];
  const vectorNormalized = normalizeScores(union, (chunk) => denseById.get(chunk.id)?.vectorScore ?? 0);
  const lexicalNormalized = normalizeScores(union, (chunk) => lexicalScores.get(chunk.id) ?? 0);
  const rawRrf = new Map(
    union.map((chunk) => {
      const densePosition = denseRank.get(chunk.id);
      const lexicalPosition = lexicalRank.get(chunk.id);
      const score =
        (densePosition ? 1 / (rankConstant + densePosition) : 0) +
        (lexicalPosition ? 1 / (rankConstant + lexicalPosition) : 0);
      return [chunk.id, score];
    })
  );
  const rrfNormalized = normalizeScores(union, (chunk) => rawRrf.get(chunk.id) ?? 0);

  return union
    .map((chunk) => {
      const vectorScore = vectorNormalized.get(chunk.id) ?? 0;
      const rawVectorScore = denseById.get(chunk.id)?.vectorScore ?? 0;
      const lexicalScore = lexicalNormalized.get(chunk.id) ?? 0;
      const rrfScore = rrfNormalized.get(chunk.id) ?? 0;
      const hybridScore = 0.55 * rrfScore + 0.25 * vectorScore + 0.2 * lexicalScore;
      return {
        ...chunk,
        rawVectorScore,
        vectorScore,
        lexicalScore,
        rrfScore,
        hybridScore,
        rerankScore: hybridScore,
        originalRank: 0
      };
    })
    .filter((candidate) => candidate.text.trim().length > 0)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .map((candidate, index) => ({ ...candidate, originalRank: index + 1 }));
}

export function queryTermCoverage(query: string, text: string): number {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return 0;
  const textTerms = new Set(tokenize(text));
  const matched = queryTerms.filter((term) => textTerms.has(term)).length;
  return matched / queryTerms.length;
}

export function featureRerank(query: string, candidates: SearchCandidate[]): SearchCandidate[] {
  const compactQuery = query.toLowerCase().replace(/\s+/g, " ").trim();
  return candidates
    .map((candidate) => {
      const coverage = queryTermCoverage(query, candidate.retrievalText);
      const headingCoverage = candidate.heading ? queryTermCoverage(query, candidate.heading) : 0;
      const exactPhrase = compactQuery.length >= 12 && candidate.retrievalText.toLowerCase().includes(compactQuery) ? 1 : 0;
      const rerankScore =
        0.58 * candidate.hybridScore + 0.27 * coverage + 0.1 * headingCoverage + 0.05 * exactPhrase;
      return {
        ...candidate,
        rerankScore,
        rerankReason: `RRF ${candidate.rrfScore.toFixed(2)}; query coverage ${Math.round(coverage * 100)}%`
      };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function normalizeScores<T extends { id: string }>(
  items: T[],
  scoreFor: (item: T) => number
): Map<string, number> {
  const values = items.map(scoreFor);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  return new Map(items.map((item) => [item.id, (scoreFor(item) - min) / range]));
}

function jaccardSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / (left.size + right.size - overlap);
}

export function mmrSelect(candidates: SearchCandidate[], limit: number, lambda = 0.76): SearchCandidate[] {
  const selected: SearchCandidate[] = [];
  const remaining = [...candidates].sort((a, b) => b.rerankScore - a.rerankScore);

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const diversityPenalty = selected.length
        ? Math.max(...selected.map((source) => jaccardSimilarity(candidate.text, source.text)))
        : 0;
      const score = lambda * candidate.rerankScore - (1 - lambda) * diversityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}
