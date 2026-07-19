import { randomUUID } from "node:crypto";
import type { RagTrace, TraceSpan } from "./types";

function elapsedSince(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(1));
}

export class TraceRecorder {
  readonly traceId = randomUUID();
  private readonly startedAt = performance.now();
  private readonly spans: TraceSpan[] = [];
  private cacheHit = false;
  private promptTokens?: number;
  private completionTokens?: number;

  constructor(
    private readonly retrievalQuery: string,
    private readonly model: string
  ) {}

  start(name: string, label: string) {
    const startedAt = performance.now();
    let ended = false;
    return (status: TraceSpan["status"] = "ok", detail?: string) => {
      if (ended) return;
      ended = true;
      this.spans.push({ name, label, durationMs: elapsedSince(startedAt), status, detail });
    };
  }

  skip(name: string, label: string, detail: string) {
    this.spans.push({ name, label, durationMs: 0, status: "skipped", detail });
  }

  markCacheHit() {
    this.cacheHit = true;
  }

  setUsage(promptTokens?: number, completionTokens?: number) {
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
  }

  finish(): RagTrace {
    return {
      traceId: this.traceId,
      totalMs: elapsedSince(this.startedAt),
      cacheHit: this.cacheHit,
      retrievalQuery: this.retrievalQuery,
      model: this.model,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      spans: [...this.spans]
    };
  }
}
