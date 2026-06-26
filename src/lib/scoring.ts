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
  const chunkTerms = chunks.map((chunk) => tokenize(`${chunk.heading ?? ""} ${chunk.text}`));
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
  const remaining = [...candidates].sort((a, b) => b.hybridScore - a.hybridScore);

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const diversityPenalty = selected.length
        ? Math.max(...selected.map((source) => jaccardSimilarity(candidate.text, source.text)))
        : 0;
      const score = lambda * candidate.hybridScore - (1 - lambda) * diversityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}
