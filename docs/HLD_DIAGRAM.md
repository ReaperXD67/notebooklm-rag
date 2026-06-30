# AtlasLM HLD Diagram

## Overall System Flow

```mermaid
flowchart TB
    U["User"] --> UI["Next.js Frontend\nUpload + Chat + Evidence Panel"]

    UI --> UploadAPI["/api/documents\nDocument Ingestion API"]
    UploadAPI --> Parser["Document Parser\nPDF / TXT / Markdown"]
    Parser --> Chunker["Page-Aware Chunker\n720 token target + overlap"]
    Chunker --> EmbedDocs["OpenRouter Embeddings\ntext-embedding-3-small"]
    EmbedDocs --> QdrantWrite["Qdrant Cloud\nVector Upsert + Payload Metadata"]

    UI --> ChatAPI["/api/chat\nQuestion Answering API"]
    ChatAPI --> EmbedQuery["OpenRouter Embeddings\nQuery Vector"]
    EmbedQuery --> DenseSearch["Qdrant Dense Search\nFiltered by documentId"]
    ChatAPI --> BM25["BM25 Lexical Search\nExact term matching"]
    DenseSearch --> Fusion["Hybrid Score Fusion\nDense + BM25"]
    BM25 --> Fusion
    Fusion --> MMR["MMR Selection\nRelevant + non-repetitive chunks"]
    MMR --> Context["Grounded Context Builder\n[S1], [S2], page numbers"]
    Context --> LLM["OpenRouter Chat Model\nGemini 2.5 Flash-Lite"]
    LLM --> Answer["Grounded Answer\nCitations required"]
    Answer --> UI
    MMR --> UIEvidence["Evidence Panel\nChunks + scores + pages"]
    UIEvidence --> UI
```

## Component View

```mermaid
flowchart LR
    subgraph Client["Client Layer"]
        A["RagWorkbench UI"]
        B["File Upload"]
        C["Chat Input"]
        D["Evidence Viewer"]
    end

    subgraph App["Next.js Server Layer"]
        E["Document API"]
        F["Chat API"]
        G["Chunking Module"]
        H["Retrieval Orchestrator"]
        I["Grounding Prompt Builder"]
    end

    subgraph External["External Services"]
        J["OpenRouter\nEmbeddings"]
        K["OpenRouter\nGeneration"]
        L["Qdrant Cloud\nVector DB"]
    end

    B --> E
    E --> G
    G --> J
    J --> L

    C --> F
    F --> J
    F --> H
    H --> L
    H --> I
    I --> K
    K --> A
    H --> D
```

## Request Flow

1. User uploads a PDF, TXT, or Markdown document.
2. The document ingestion API extracts readable text.
3. The chunker splits text into page-aware overlapping chunks.
4. Each chunk is embedded using OpenRouter embeddings.
5. Chunks and metadata are stored in Qdrant Cloud.
6. User asks a natural language question.
7. The question is embedded.
8. Qdrant retrieves semantically similar chunks.
9. BM25 scores exact keyword relevance across document chunks.
10. Hybrid fusion combines semantic and lexical relevance.
11. MMR selects the most useful non-repetitive chunks.
12. The LLM receives only retrieved source context.
13. The answer is returned with citations like `[S1]`.
14. The UI shows source chunks, page numbers, and retrieval scores.

## Grounding Boundary

```mermaid
sequenceDiagram
    participant User
    participant UI as Frontend
    participant API as Chat API
    participant VDB as Qdrant
    participant LLM as OpenRouter LLM

    User->>UI: Ask question
    UI->>API: documentId + question
    API->>VDB: Search only chunks for documentId
    VDB-->>API: Relevant chunks
    API->>API: BM25 + hybrid fusion + MMR
    API->>LLM: Question + retrieved chunks only
    LLM-->>API: Cited grounded answer
    API-->>UI: Answer + source evidence
    UI-->>User: Show answer and citations
```

The main grounding rule is that the LLM never receives the whole internet or a general prompt alone. It receives the user question plus selected chunks from the uploaded document, and the prompt requires citation-backed answers.

