import type { CitationSource } from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function openRouterHeaders() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local or your deployment settings.");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
    "X-Title": "AtlasLM RAG"
  };
}

async function openRouterFetch(path: string, body: unknown) {
  const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
  const vectors: number[][] = [];
  const batchSize = 48;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const json = await openRouterFetch("/embeddings", {
      model,
      input: batch
    });

    const batchVectors = [...json.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding as number[]);
    vectors.push(...batchVectors);
  }

  return vectors;
}

export async function generateGroundedAnswer({
  question,
  sources,
  strictMode
}: {
  question: string;
  sources: CitationSource[];
  strictMode: boolean;
}): Promise<string> {
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
  const context = sources
    .map(
      (source) =>
        `${source.citation} ${source.sourceName}, page ${source.pageNumber}, chunk ${source.chunkIndex}\n${source.text}`
    )
    .join("\n\n---\n\n");

  const systemPrompt = `You are AtlasLM, a strict source-grounded document analyst.

Rules:
- Answer only from the provided source excerpts.
- Cite every factual claim with source labels like [S1] or [S2].
- If the excerpts do not contain enough evidence, say exactly what is missing.
- Do not use general knowledge or unstated assumptions.
- Prefer concise, useful answers. Include examples only when the document contains them.
- Strict mode is ${strictMode ? "ON" : "OFF"}. When strict mode is ON, refuse weakly supported answers.`;

  const json = await openRouterFetch("/chat/completions", {
    model,
    temperature: 0.1,
    max_tokens: 900,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Question:\n${question}\n\nSource excerpts:\n${context}`
      }
    ]
  });

  return json.choices?.[0]?.message?.content?.trim() ?? "I could not generate an answer from the retrieved context.";
}
