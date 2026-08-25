<![CDATA[<div align="center">

# 🧠 NOVA — AI-Powered Research Assistant

**Upload PDFs. Ask Questions. Get Cited Answers.**

A full-stack Retrieval-Augmented Generation (RAG) chatbot that lets you upload research PDFs, ask questions in natural language, and receive accurate, citation-backed answers with real-time streaming — powered by Google Gemini and sentence-transformers.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-AI-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 📄 **Multi-Document RAG** | Upload multiple PDFs — text is extracted page-by-page, chunked into 500-character segments, and embedded using `all-MiniLM-L6-v2` |
| 🔍 **Smart Retrieval** | Cosine similarity search with a 0.35 threshold filter returns only the most relevant chunks |
| 📑 **Source Citations** | Every answer includes structured citations with document name, page number, and relevance rank |
| 💬 **Conversation Memory** | Multi-turn session history preserves context across follow-up questions |
| 🎛️ **3 Response Modes** | **Beginner** (simple analogies), **Research** (technical depth), **Interview** (structured bullet points) |
| ⚡ **Real-Time Streaming** | Token-by-token response streaming via Server-Sent Events (SSE) |
| 📐 **Math Rendering** | KaTeX integration for rendering mathematical expressions and formulas |
| 🎙️ **Voice Input** | Speech-to-text via the Web Speech API — speak your questions |
| 🔊 **Read Aloud** | Text-to-speech to listen to AI responses |
| 📑 **In-App PDF Viewer** | Built-in PDF.js viewer with page navigation, zoom controls, and citation-linked page jumping |
| 💡 **AI Starter Questions** | Auto-generated exploration questions tailored to each uploaded document |
| 📥 **Export Chat** | Download your conversation as a Markdown file |
| 🌙 **Premium Dark UI** | Glassmorphism design with smooth animations, gradient accents, and responsive layout |

---

## 🏗️ Architecture — The 6 RAG Phases

This project implements the complete RAG research pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│                        NOVA Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase 1: Multi-Document Ingestion                              │
│  ├── PDF text extraction (pypdf)                                │
│  └── 500-character chunking with page-level tracking            │
│                                                                 │
│  Phase 2: Source Tracking                                       │
│  └── Each chunk stores: { text, document_name, page_number }   │
│                                                                 │
│  Phase 3: Citation Generation                                   │
│  └── Structured citations (doc + page + rank) sent per answer   │
│                                                                 │
│  Phase 4: Retrieval Quality                                     │
│  ├── Cosine similarity with all-MiniLM-L6-v2 embeddings        │
│  ├── Top-5 retrieval with 0.35 similarity threshold             │
│  └── Contextual fallback using conversation history             │
│                                                                 │
│  Phase 5: Conversation Memory                                   │
│  └── Session-based multi-turn chat history                      │
│                                                                 │
│  Phase 6: Advanced Prompt Engineering                            │
│  └── 3 mode-specific prompt templates (Beginner/Research/       │
│      Interview) with history + context injection                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Backend
- **[FastAPI](https://fastapi.tiangolo.com/)** — High-performance async Python web framework
- **[Google Gemini](https://ai.google.dev/)** (`gemini-3.6-flash`) — LLM for answer generation
- **[Sentence Transformers](https://www.sbert.net/)** (`all-MiniLM-L6-v2`) — Dense vector embeddings
- **[scikit-learn](https://scikit-learn.org/)** — Cosine similarity computation
- **[pypdf](https://pypdf.readthedocs.io/)** — PDF text extraction
- **[Uvicorn](https://www.uvicorn.org/)** — ASGI server

### Frontend
- **Vanilla HTML/CSS/JavaScript** — No framework dependencies
- **[PDF.js](https://mozilla.github.io/pdf.js/)** — In-app PDF rendering
- **[KaTeX](https://katex.org/)** — LaTeX math rendering
- **[Marked](https://marked.js.org/)** — Markdown-to-HTML parsing
- **Web Speech API** — Voice input & text-to-speech

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- A [Google Gemini API key](https://aistudio.google.com/apikey)

### 1. Clone the Repository

```bash
git clone https://github.com/Codinggenie2004/NOVA-AI-Chatbot.git
cd NOVA-AI-Chatbot
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Set Up Environment Variables

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Run the Application

```bash
python app.py
```

The server will start at **http://localhost:8000**. Open it in your browser to begin.

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve the frontend UI |
| `POST` | `/api/upload` | Upload a PDF document for indexing |
| `GET` | `/api/documents` | List all indexed documents & chunk count |
| `GET` | `/api/documents/{filename}/file` | Serve a PDF file for in-app viewing |
| `DELETE` | `/api/documents/{filename}` | Remove a document from the index |
| `POST` | `/api/chat` | Send a question (SSE streaming response) |
| `POST` | `/api/chat/stream` | Alias for `/api/chat` |
| `POST` | `/api/chat/clear?session_id=...` | Clear conversation history for a session |

### Chat Request Body

```json
{
  "question": "What are the main findings?",
  "mode": "beginner",
  "session_id": "optional-uuid"
}
```

**Modes:** `beginner` | `research` | `interview`

---

## 📁 Project Structure

```
NOVA-AI-Chatbot/
├── app.py                 # FastAPI backend — all 6 RAG phases
├── requirements.txt       # Python dependencies
├── Procfile               # Cloud deployment (Heroku/Render)
├── .env                   # Environment variables (not tracked)
├── .gitignore
└── static/
    ├── index.html         # Frontend UI
    ├── index.css          # Premium dark theme design system
    └── app.js             # Frontend logic (chat, PDF viewer, voice, etc.)
```

---

## ☁️ Deployment

The app is cloud-ready with a `Procfile` for platforms like **Heroku** or **Render**:

```
web: uvicorn app:app --host 0.0.0.0 --port $PORT
```

Set the `GEMINI_API_KEY` environment variable in your cloud platform's dashboard.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<div align="center">

**Built with ❤️ by [Codinggenie2004](https://github.com/Codinggenie2004)**

</div>
]]>
