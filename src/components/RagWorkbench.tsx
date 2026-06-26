"use client";

import {
  Activity,
  BookOpenCheck,
  BrainCircuit,
  FileUp,
  Gauge,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Send,
  Sparkles
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { CitationSource, UploadedDocumentSummary } from "@/lib/types";

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: CitationSource[];
};

type UploadResponse = {
  document: UploadedDocumentSummary;
  previewChunks: Array<{ pageNumber: number; chunkIndex: number; text: string }>;
  error?: string;
};

type PreviewChunk = UploadResponse["previewChunks"][number];

type ChatResponse = {
  answer: string;
  sources: CitationSource[];
  retrieval: {
    denseCandidates: number;
    lexicalCorpus: number;
    selectedSources: number;
  };
  error?: string;
};

function isCitationSource(source: CitationSource | PreviewChunk): source is CitationSource {
  return "citation" in source && typeof source.citation === "string";
}

export function RagWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<UploadedDocumentSummary | null>(null);
  const [previewChunks, setPreviewChunks] = useState<UploadResponse["previewChunks"]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topK, setTopK] = useState(6);
  const [strictMode, setStrictMode] = useState(true);

  const lastSources = useMemo(
    () => [...messages].reverse().find((message) => message.sources)?.sources ?? [],
    [messages]
  );

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    setError(null);
    setMessages([]);
    setPreviewChunks([]);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/documents", {
      method: "POST",
      body: formData
    });
    const json = (await response.json()) as UploadResponse;

    setUploading(false);
    if (!response.ok || json.error) {
      setError(json.error ?? "Upload failed.");
      return;
    }

    setDocument(json.document);
    setPreviewChunks(json.previewChunks);
  }

  async function handleQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !document) return;

    setQuestion("");
    setAsking(true);
    setError(null);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: document.id,
        question: trimmed,
        options: { topK, strictMode }
      })
    });
    const json = (await response.json()) as ChatResponse;

    setAsking(false);
    if (!response.ok || json.error) {
      setError(json.error ?? "Question failed.");
      return;
    }

    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: json.answer,
        sources: json.sources
      }
    ]);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BrainCircuit size={22} />
          </div>
          <div>
            <p className="eyebrow">Assignment 03</p>
            <h1>AtlasLM</h1>
          </div>
        </div>
        <div className="status-strip" aria-label="Pipeline status">
          <span>
            <FileUp size={16} /> Upload
          </span>
          <span>
            <Layers3 size={16} /> Chunk
          </span>
          <span>
            <Activity size={16} /> Retrieve
          </span>
          <span>
            <BookOpenCheck size={16} /> Cite
          </span>
        </div>
      </header>

      <section className="workspace">
        <aside className="source-panel panel">
          <div className="panel-title">
            <FileUp size={18} />
            <h2>Source</h2>
          </div>

          <form onSubmit={handleUpload} className="upload-box">
            <label className="file-target">
              <input
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span>{file ? file.name : "Drop a PDF or text file"}</span>
            </label>
            <button className="primary-button" type="submit" disabled={!file || uploading}>
              <FileUp size={17} />
              {uploading ? "Indexing" : "Index source"}
            </button>
          </form>

          {document && (
            <div className="metric-grid">
              <div>
                <span>Pages</span>
                <strong>{document.pageCount}</strong>
              </div>
              <div>
                <span>Chunks</span>
                <strong>{document.chunkCount}</strong>
              </div>
              <div>
                <span>Vectors</span>
                <strong>{document.vectorDimensions}</strong>
              </div>
              <div>
                <span>4-bit est.</span>
                <strong>{document.memoryEstimate.reductionRatio}x</strong>
              </div>
            </div>
          )}

          <div className="control-stack">
            <label>
              <span>Evidence depth</span>
              <input
                type="range"
                min="3"
                max="10"
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
              />
              <strong>{topK}</strong>
            </label>
            <label className="switch-row">
              <span>
                <LockKeyhole size={15} /> Strict grounding
              </span>
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(event) => setStrictMode(event.target.checked)}
              />
            </label>
          </div>

          {document && (
            <div className="strategy">
              <p className="eyebrow">Chunking</p>
              <h3>{document.chunkStrategy.name}</h3>
              <p>{document.chunkStrategy.description}</p>
            </div>
          )}
        </aside>

        <section className="conversation-panel panel">
          <div className="panel-title">
            <MessageSquareText size={18} />
            <h2>Conversation</h2>
          </div>

          <div className="message-stream" aria-live="polite">
            {messages.length === 0 && (
              <div className="empty-state">
                <Sparkles size={24} />
                <p>{document ? "Ask from the indexed source." : "Upload a source to begin."}</p>
              </div>
            )}
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <span>{message.role === "user" ? "You" : "AtlasLM"}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {asking && (
              <article className="message assistant thinking">
                <span>AtlasLM</span>
                <p>Retrieving evidence and checking citations...</p>
              </article>
            )}
          </div>

          {error && <p className="error-line">{error}</p>}

          <form onSubmit={handleQuestion} className="ask-bar">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={document ? "Ask a grounded question" : "Index a document first"}
              disabled={!document || asking}
            />
            <button className="icon-button" type="submit" disabled={!document || asking || !question.trim()}>
              <Send size={18} />
              <span className="sr-only">Send</span>
            </button>
          </form>
        </section>

        <aside className="evidence-panel panel">
          <div className="panel-title">
            <Gauge size={18} />
            <h2>Evidence</h2>
          </div>

          <div className="source-list">
            {(lastSources.length ? lastSources : previewChunks).map((source) => {
              const item = isCitationSource(source) ? source : null;
              return (
                <article key={item?.id ?? `${source.pageNumber}-${source.chunkIndex}`} className="source-item">
                  <div>
                    <strong>{item?.citation ?? `P${source.pageNumber}`}</strong>
                    <span>Page {source.pageNumber}</span>
                  </div>
                  <p>{source.text}</p>
                  {item && (
                    <footer>
                      <span>Hybrid {item.hybridScore}</span>
                      <span>Dense {item.vectorScore}</span>
                      <span>BM25 {item.lexicalScore}</span>
                    </footer>
                  )}
                </article>
              );
            })}
          </div>

          <div className="report-visual">
            <img src="/report/notebooklm-comparison.svg" alt="AtlasLM comparison chart" />
          </div>
        </aside>
      </section>
    </main>
  );
}
