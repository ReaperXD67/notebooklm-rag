"use client";

import {
  Activity,
  BadgeCheck,
  Binary,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Database,
  FileCheck2,
  FileSearch,
  FileText,
  FileUp,
  Fingerprint,
  FlaskConical,
  Gauge,
  GraduationCap,
  Hash,
  Layers3,
  ListChecks,
  LockKeyhole,
  MessageSquareText,
  Network,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UploadCloud,
  WandSparkles,
  X,
  Zap
} from "lucide-react";
import { DragEvent, FormEvent, KeyboardEvent, ReactNode, useMemo, useState } from "react";
import type {
  CitationSource,
  RagAnswerResponse,
  RagTrace,
  RetrievalMode,
  UploadedDocumentSummary
} from "@/lib/types";

const MAX_CLIENT_FILE_BYTES = 4 * 1024 * 1024;

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: RagAnswerResponse;
};

type UploadResponse = {
  document: UploadedDocumentSummary;
  previewChunks: Array<{ pageNumber: number; chunkIndex: number; text: string }>;
  error?: string;
};

type PreviewChunk = UploadResponse["previewChunks"][number];

type InspectorTab = "evidence" | "trace" | "evals" | "research";

type ProbeResult = {
  passed: boolean;
  probe: string;
  expected: string;
  actual: string;
  trace: RagTrace;
  error?: string;
};

const quickActions = [
  { label: "Executive brief", prompt: "Create a concise executive brief of this document with the key findings.", icon: FileText },
  { label: "Study guide", prompt: "Create a study guide with the most important concepts and definitions.", icon: GraduationCap },
  { label: "Evidence map", prompt: "Map the main claims to their supporting evidence and note any gaps.", icon: Network },
  { label: "Find tensions", prompt: "Identify contradictions, tradeoffs, or unresolved questions in this document.", icon: ScanSearch }
];

const productionChecks = [
  ["Ingest + normalize", "Headers, whitespace, metadata, content identity"],
  ["Hybrid retrieval", "Dense ANN + contextual BM25"],
  ["ANN + reranking", "RRF, feature ranker, optional LLM listwise judge"],
  ["Source confidence", "Coverage, retrieval strength, source agreement"],
  ["Constrained generation", "Untrusted-context isolation and source-only prompt"],
  ["Citation-backed", "Claim-level labels audited after generation"],
  ["Hallucination fallback", "Sufficiency gate can block generation entirely"],
  ["Continuous evals", "CI tests plus live adversarial canary"],
  ["Caching + memory", "Semantic cache and follow-up query memory"],
  ["Observability", "Trace ID, stage latency, counts, model usage"]
];

function newMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isCitationSource(source: CitationSource | PreviewChunk): source is CitationSource {
  return "citation" in source && typeof source.citation === "string";
}

function AnswerText({ text, onCitation }: { text: string; onCitation: (citation: string) => void }) {
  const parts = text.split(/(\[S\d+(?:\s*,\s*S\d+)*\])/g);
  return (
    <div className="answer-text">
      {parts.map((part, index) =>
        /^\[S\d+(?:\s*,\s*S\d+)*\]$/.test(part) ? (
          <span className="citation-group" key={`${part}-${index}`}>
            {(part.match(/S\d+/g) ?? []).map((label) => (
              <button key={label} type="button" className="citation-link" onClick={() => onCitation(`[${label}]`)}>
                [{label}]
              </button>
            ))}
          </span>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        )
      )}
    </div>
  );
}

function ConfidenceRing({ value, status }: { value: number; status: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="confidence-block">
      <div
        className={`confidence-ring ${status}`}
        style={{ background: `conic-gradient(var(--signal) ${percent * 3.6}deg, var(--track) 0deg)` }}
        aria-label={`${percent} percent evidence confidence`}
      >
        <div>
          <strong>{percent}</strong>
          <span>confidence</span>
        </div>
      </div>
      <div>
        <p className="micro-label">Evidence state</p>
        <h3>{status}</h3>
        <p>Calibrated before the answer reaches the model.</p>
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="metric-cell">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function RagWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<UploadedDocumentSummary | null>(null);
  const [previewChunks, setPreviewChunks] = useState<PreviewChunk[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topK, setTopK] = useState(6);
  const [strictMode, setStrictMode] = useState(true);
  const [mode, setMode] = useState<RetrievalMode>("efficient");
  const [dragging, setDragging] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("evidence");
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  const lastResult = useMemo(
    () => [...messages].reverse().find((message) => message.result)?.result ?? null,
    [messages]
  );
  const visibleSources: Array<CitationSource | PreviewChunk> = lastResult?.sources.length
    ? lastResult.sources
    : previewChunks;

  function chooseFile(nextFile: File | null) {
    setError(null);
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (nextFile.size > MAX_CLIENT_FILE_BYTES) {
      setFile(null);
      setError("Use a PDF, TXT, or Markdown file under 4 MB for the live demo.");
      return;
    }
    setFile(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessages([]);
    setPreviewChunks([]);
    setProbe(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/documents", { method: "POST", body: formData });
      const json = (await response.json()) as UploadResponse;
      if (!response.ok || json.error) throw new Error(json.error ?? "Upload failed.");
      setDocument(json.document);
      setPreviewChunks(json.previewChunks);
      setInspectorTab("research");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function askQuestion(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || !document || asking) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setQuestion("");
    setAsking(true);
    setError(null);
    setMessages((current) => [...current, { id: newMessageId(), role: "user", content: trimmed }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          question: trimmed,
          history,
          options: { topK, strictMode, mode }
        })
      });
      const json = (await response.json()) as RagAnswerResponse & { error?: string };
      if (!response.ok || json.error) throw new Error(json.error ?? "Question failed.");
      setMessages((current) => [
        ...current,
        { id: newMessageId(), role: "assistant", content: json.answer, result: json }
      ]);
      setActiveSourceId(json.sources[0]?.id ?? null);
      setInspectorTab("evidence");
    } catch (questionError) {
      setError(questionError instanceof Error ? questionError.message : "Question failed.");
    } finally {
      setAsking(false);
    }
  }

  function handleQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askQuestion(question);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void askQuestion(question);
    }
  }

  function openCitation(citation: string) {
    const source = lastResult?.sources.find((item) => item.citation === citation);
    if (source) {
      setActiveSourceId(source.id);
      setInspectorTab("evidence");
    }
  }

  async function runProbe() {
    if (!document || probing) return;
    setProbing(true);
    setProbe(null);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: document.id })
      });
      const json = (await response.json()) as ProbeResult;
      if (!response.ok || json.error) throw new Error(json.error ?? "Evaluation failed.");
      setProbe(json);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : "Evaluation failed.");
    } finally {
      setProbing(false);
    }
  }

  function clearWorkspace() {
    setDocument(null);
    setFile(null);
    setPreviewChunks([]);
    setMessages([]);
    setProbe(null);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="command-bar">
        <div className="brand-lockup">
          <div className="brand-mark"><BrainCircuit size={22} /></div>
          <div>
            <p>AtlasLM</p>
            <span>Evidence operating system</span>
          </div>
        </div>

        <div className="pipeline-ribbon" aria-label="RAG pipeline">
          <span><FileCheck2 size={14} /> Normalize</span>
          <ChevronRight size={13} />
          <span><Layers3 size={14} /> Contextualize</span>
          <ChevronRight size={13} />
          <span><Network size={14} /> Hybrid + RRF</span>
          <ChevronRight size={13} />
          <span><ShieldCheck size={14} /> Audit</span>
        </div>

        <div className="system-badge">
          <span className="live-dot" />
          <div><strong>10 / 10</strong><small>production checks</small></div>
        </div>
      </header>

      <section className="workbench">
        <aside className="source-rail">
          <div className="rail-heading">
            <div><p className="micro-label">Workspace</p><h2>Source control</h2></div>
            {document && <button type="button" className="tool-button" onClick={clearWorkspace} title="Clear workspace"><X size={17} /></button>}
          </div>

          <form onSubmit={handleUpload} className="source-upload">
            <label
              className={`drop-target ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              />
              {file ? <FileCheck2 size={22} /> : <UploadCloud size={22} />}
              <div>
                <strong>{file ? file.name : dragging ? "Release to index" : "Drop a source"}</strong>
                <span>{file ? formatBytes(file.size) : "PDF, TXT or Markdown · 4 MB"}</span>
              </div>
            </label>
            <button className="index-button" type="submit" disabled={!file || uploading}>
              {uploading ? <RefreshCw className="spin" size={17} /> : <FileUp size={17} />}
              {uploading ? "Building evidence index" : document ? "Re-index source" : "Index source"}
            </button>
          </form>

          {document ? (
            <div className="document-profile">
              <div className="document-name">
                <div className="file-glyph"><FileText size={20} /></div>
                <div><strong>{document.name}</strong><span>Ready for grounded research</span></div>
              </div>
              <div className="document-metrics">
                <Metric label="Pages" value={document.pageCount} icon={<BookOpen size={13} />} />
                <Metric label="Chunks" value={document.chunkCount} icon={<Layers3 size={13} />} />
                <Metric label="Index" value={`${document.vectorDimensions}d`} icon={<Database size={13} />} />
                <Metric label="TQ gain" value={`${document.memoryEstimate.reductionRatio}×`} icon={<Binary size={13} />} />
              </div>
              <div className="fingerprint-row">
                <Fingerprint size={14} />
                <span>{document.contentFingerprint}</span>
                <em>content addressed</em>
              </div>
              <div className={`quantization-row ${document.vectorIndex.quantizationAvailable ? "active" : "fallback"}`}>
                <Zap size={14} />
                <span>{document.vectorIndex.quantizationAvailable ? "TurboQuant 4-bit active" : "Float32 compatibility mode"}</span>
              </div>
            </div>
          ) : (
            <div className="source-placeholder">
              <FileSearch size={18} />
              <p>Your document stays isolated by a content-derived workspace ID.</p>
            </div>
          )}

          <div className="retrieval-controls">
            <div className="section-label"><p>Retrieval engine</p><span>{mode}</span></div>
            <div className="segmented-control" aria-label="Retrieval mode">
              <button type="button" className={mode === "efficient" ? "active" : ""} onClick={() => setMode("efficient")}>
                <Zap size={14} /> Efficient
              </button>
              <button type="button" className={mode === "precision" ? "active" : ""} onClick={() => setMode("precision")}>
                <WandSparkles size={14} /> Precision
              </button>
            </div>
            <label className="range-control">
              <span><span>Evidence depth</span><strong>{topK} passages</strong></span>
              <input type="range" min="3" max="10" value={topK} onChange={(event) => setTopK(Number(event.target.value))} />
            </label>
            <label className="toggle-control">
              <span><LockKeyhole size={15} /><span><strong>Strict grounding</strong><small>Abstain when evidence is weak</small></span></span>
              <input type="checkbox" checked={strictMode} onChange={(event) => setStrictMode(event.target.checked)} />
              <i aria-hidden="true" />
            </label>
          </div>

          <div className="cost-note">
            <CircleGauge size={16} />
            <p><strong>{mode === "precision" ? "Precision adds one judge call" : "Cost-aware retrieval"}</strong><span>{mode === "precision" ? "Gemini Flash-Lite ranks passages together." : "Local reranking runs before one answer call."}</span></p>
          </div>
        </aside>

        <section className="conversation-stage">
          <div className="conversation-heading">
            <div>
              <p className="micro-label">Grounded thread</p>
              <h2>{document ? document.name : "No source indexed"}</h2>
            </div>
            <div className="thread-status">
              <span className={document ? "ready" : "idle"}>{document ? "Evidence online" : "Waiting for source"}</span>
              <span>{mode === "precision" ? "LLM reranker" : "Feature reranker"}</span>
            </div>
          </div>

          <div className="message-stream" aria-live="polite">
            {messages.length === 0 && (
              <div className="empty-workspace">
                <div className="empty-signal"><Sparkles size={22} /></div>
                <p className="micro-label">Research canvas</p>
                <h1>{document ? "Interrogate the evidence." : "Bring a document into focus."}</h1>
                <p>{document ? "Every claim will be routed back through retrieval, sufficiency, and citation checks." : "Upload an unseen PDF or text source. AtlasLM will build a inspectable evidence index around it."}</p>
                <div className="quick-grid">
                  {quickActions.map(({ label, prompt, icon: Icon }) => (
                    <button key={label} type="button" disabled={!document} onClick={() => void askQuestion(prompt)}>
                      <Icon size={17} /><span>{label}</span><ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <article key={message.id} className={`message-row ${message.role}`}>
                <div className="message-avatar">{message.role === "user" ? "A" : <Bot size={17} />}</div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{message.role === "user" ? "You" : "AtlasLM"}</strong>
                    {message.result && (
                      <span className={`answer-state ${message.result.abstained ? "abstained" : "grounded"}`}>
                        {message.result.abstained ? "Safely abstained" : `${Math.round(message.result.evidence.confidence * 100)}% grounded`}
                      </span>
                    )}
                  </div>
                  {message.role === "assistant" ? <AnswerText text={message.content} onCitation={openCitation} /> : <p>{message.content}</p>}
                  {message.result && (
                    <footer className="answer-footer">
                      <button type="button" onClick={() => setInspectorTab("evidence")}><BookOpen size={13} /> {message.result.sources.length} sources</button>
                      <button type="button" onClick={() => setInspectorTab("trace")}><Activity size={13} /> {Math.round(message.result.trace.totalMs)} ms</button>
                      <button type="button" onClick={() => setInspectorTab("evals")}><ShieldCheck size={13} /> {Math.round(message.result.citationAudit.coverage * 100)}% cited</button>
                      {message.result.trace.cacheHit && <span><Zap size={13} /> cache hit</span>}
                    </footer>
                  )}
                </div>
              </article>
            ))}

            {asking && (
              <article className="message-row assistant thinking-row">
                <div className="message-avatar"><Bot size={17} /></div>
                <div className="thinking-body">
                  <div className="thinking-line"><i /><i /><i /></div>
                  <span>{mode === "precision" ? "Fusing and judging evidence" : "Fusing and auditing evidence"}</span>
                </div>
              </article>
            )}
          </div>

          {error && <div className="error-banner"><span>{error}</span><button type="button" onClick={() => setError(null)} title="Dismiss error"><X size={15} /></button></div>}

          <form onSubmit={handleQuestion} className="composer">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={document ? "Ask a question grounded in this source…" : "Index a document to unlock research"}
              disabled={!document || asking}
              rows={2}
            />
            <div className="composer-footer">
              <span><LockKeyhole size={13} /> Source-only generation</span>
              <button className="send-button" type="submit" disabled={!document || asking || !question.trim()} title="Send question">
                <Send size={17} /><span>Send</span>
              </button>
            </div>
          </form>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs" role="tablist">
            <button type="button" className={inspectorTab === "evidence" ? "active" : ""} onClick={() => setInspectorTab("evidence")}><BookOpen size={15} /> Evidence</button>
            <button type="button" className={inspectorTab === "trace" ? "active" : ""} onClick={() => setInspectorTab("trace")}><Activity size={15} /> Trace</button>
            <button type="button" className={inspectorTab === "evals" ? "active" : ""} onClick={() => setInspectorTab("evals")}><FlaskConical size={15} /> Evals</button>
            <button type="button" className={inspectorTab === "research" ? "active" : ""} onClick={() => setInspectorTab("research")}><BrainCircuit size={15} /> Stack</button>
          </div>

          <div className="inspector-scroll">
            {inspectorTab === "evidence" && (
              <>
                {lastResult ? (
                  <>
                    <ConfidenceRing value={lastResult.evidence.confidence} status={lastResult.evidence.status} />
                    <div className="score-strip">
                      <div><span>Retrieval</span><strong>{Math.round(lastResult.evidence.retrievalStrength * 100)}%</strong></div>
                      <div><span>Coverage</span><strong>{Math.round(lastResult.evidence.queryCoverage * 100)}%</strong></div>
                      <div><span>Agreement</span><strong>{Math.round(lastResult.evidence.sourceAgreement * 100)}%</strong></div>
                    </div>
                    <div className="evidence-reason"><ShieldCheck size={15} /><p>{lastResult.evidence.reason}</p></div>
                  </>
                ) : (
                  <div className="inspector-empty"><Gauge size={21} /><h3>Evidence console</h3><p>Retrieved sources and calibrated confidence will appear after a question.</p></div>
                )}

                <div className="source-list">
                  <div className="list-heading"><p>Retrieved passages</p><span>{visibleSources.length}</span></div>
                  {visibleSources.map((source) => {
                    const item = isCitationSource(source) ? source : null;
                    const key = item?.id ?? `${source.pageNumber}-${source.chunkIndex}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`source-item ${activeSourceId === item?.id ? "active" : ""}`}
                        onClick={() => item && setActiveSourceId(item.id)}
                      >
                        <div className="source-topline">
                          <strong>{item?.citation ?? `P${source.pageNumber}`}</strong>
                          <span>page {source.pageNumber} · chunk {source.chunkIndex + 1}</span>
                          {item && <em>#{item.finalRank}</em>}
                        </div>
                        {item?.heading && <h4>{item.heading}</h4>}
                        <p>{source.text}</p>
                        {item && (
                          <div className="score-bars">
                            <span><i style={{ width: `${item.rerankScore * 100}%` }} />Rerank {item.rerankScore.toFixed(2)}</span>
                            <span><i style={{ width: `${item.rrfScore * 100}%` }} />RRF {item.rrfScore.toFixed(2)}</span>
                            <span><i style={{ width: `${item.lexicalScore * 100}%` }} />BM25 {item.lexicalScore.toFixed(2)}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {inspectorTab === "trace" && (
              <div className="trace-view">
                <div className="inspector-title"><div><p className="micro-label">RAG flight recorder</p><h3>Request trace</h3></div>{lastResult?.trace.cacheHit && <span>cache hit</span>}</div>
                {lastResult ? (
                  <>
                    <div className="trace-summary">
                      <div><Clock3 size={15} /><span>Total latency</span><strong>{Math.round(lastResult.trace.totalMs)} ms</strong></div>
                      <div><Hash size={15} /><span>Trace ID</span><strong>{lastResult.trace.traceId.slice(0, 8)}</strong></div>
                      <div><BrainCircuit size={15} /><span>Model</span><strong>{lastResult.trace.model.split("/").pop()}</strong></div>
                      <div><Database size={15} /><span>Candidates</span><strong>{lastResult.retrieval.fusedCandidates}</strong></div>
                    </div>
                    <div className="query-rewrite">
                      <p className="micro-label">Retrieval query</p>
                      <p>{lastResult.trace.retrievalQuery}</p>
                    </div>
                    <div className="trace-timeline">
                      {lastResult.trace.spans.map((span, index) => (
                        <div key={`${span.name}-${index}`} className={`trace-stage ${span.status}`}>
                          <div className="trace-node">{span.status === "ok" ? <Check size={12} /> : span.status === "error" ? <X size={12} /> : <ChevronRight size={12} />}</div>
                          <div className="trace-copy"><strong>{span.label}</strong><span>{span.detail}</span></div>
                          <time>{span.durationMs ? `${Math.round(span.durationMs)} ms` : "skip"}</time>
                        </div>
                      ))}
                    </div>
                    <div className="token-row"><span>Prompt tokens <strong>{lastResult.trace.promptTokens ?? "—"}</strong></span><span>Output tokens <strong>{lastResult.trace.completionTokens ?? "—"}</strong></span></div>
                  </>
                ) : <div className="inspector-empty"><TimerReset size={21} /><h3>No trace yet</h3><p>Ask a question to record every retrieval and grounding stage.</p></div>}
              </div>
            )}

            {inspectorTab === "evals" && (
              <div className="eval-view">
                <div className="inspector-title"><div><p className="micro-label">Continuous quality</p><h3>Grounding eval lab</h3></div>{lastResult && <span>{Math.round(lastResult.evaluation.score * 100)} / 100</span>}</div>
                {lastResult ? (
                  <div className="eval-checks">
                    {lastResult.evaluation.checks.map((check) => (
                      <div key={check.name} className={check.passed ? "passed" : "failed"}>
                        <span>{check.passed ? <BadgeCheck size={17} /> : <X size={17} />}</span>
                        <p><strong>{check.name}</strong><small>{check.value}</small></p>
                      </div>
                    ))}
                  </div>
                ) : <div className="inspector-empty compact"><FlaskConical size={20} /><h3>Awaiting an answer</h3><p>Claim coverage and evidence gates are scored on every response.</p></div>}

                <div className="adversarial-lab">
                  <div><p className="micro-label">Adversarial probe</p><h4>Out-of-document canary</h4><p>Tests whether the system refuses a plausible-sounding question whose identifier is absent.</p></div>
                  <button type="button" onClick={() => void runProbe()} disabled={!document || probing}>
                    {probing ? <RefreshCw className="spin" size={15} /> : <FlaskConical size={15} />}
                    {probing ? "Running guardrail" : "Run live probe"}
                  </button>
                  {probe && <div className={`probe-result ${probe.passed ? "passed" : "failed"}`}><strong>{probe.passed ? "PASS · Safe abstention" : "FAIL · Guardrail missed"}</strong><p>{probe.actual}</p></div>}
                </div>

                <div className="ci-note"><Activity size={15} /><p><strong>CI benchmark suite</strong><span>Chunking, RRF, reranking, identifier abstention, and citation audits run on every push.</span></p></div>
              </div>
            )}

            {inspectorTab === "research" && (
              <div className="research-view">
                <div className="inspector-title"><div><p className="micro-label">Advanced RAG stack</p><h3>Production checklist</h3></div><span>10 active</span></div>
                <div className="production-list">
                  {productionChecks.map(([title, detail], index) => (
                    <div key={title}><span>{String(index + 1).padStart(2, "0")}</span><p><strong>{title}</strong><small>{detail}</small></p><BadgeCheck size={16} /></div>
                  ))}
                </div>
                <div className="turbo-panel">
                  <div><Binary size={19} /><span>Qdrant 1.18</span></div>
                  <h4>Real TurboQuant, capability negotiated.</h4>
                  <p>4-bit rotated vector compression is enabled when the cluster supports it, with Float32 fallback and rescoring for compatibility.</p>
                  {document && <div className="memory-comparison"><span><small>FP32 estimate</small><strong>{document.memoryEstimate.fp32Kb} KB</strong></span><ChevronRight size={15} /><span><small>TurboQuant estimate</small><strong>{document.memoryEstimate.turboQuant4BitKb} KB</strong></span></div>}
                </div>
                <div className="comparison-visual"><img src="/report/notebooklm-comparison.svg" alt="AtlasLM and NotebookLM engineering comparison" /></div>
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
