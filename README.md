# NOVA — AI Research Assistant

A Retrieval-Augmented Generation (RAG) assistant that allows users to upload research PDFs, ask questions, and receive citation-backed answers streamed in real time via FastAPI, FastEmbed, and Google Gemini.

---

## Features

- **Multi-Document Ingestion**: Extracts text from PDFs in 500-character chunks with 100-character overlap.
- **Hybrid Retrieval**: Combines 65% dense vector cosine similarity (FastEmbed ONNX `all-MiniLM-L6-v2`) and 35% BM25 keyword matching with a 0.35 similarity cutoff.
- **Source Citations**: Returns document name, page number, and confidence score for each answer.
- **Conversation Memory**: Multi-turn chat history with contextual follow-up query expansion.
- **Prompt Modes**: Beginner (<250 words), Research (<500 words), and Interview (<350 words).
- **Ephemeral Zero-Retention**: Wipes session documents, embeddings, and chat history upon browser close or 10-minute inactivity.
- **In-App PDF Viewer**: PDF.js canvas viewer with citation page jumping and math rendering (KaTeX).

---

## Tech Stack

### Backend
- **Framework**: FastAPI + Uvicorn
- **LLM**: Google Gemini (`gemini-2.5-flash`, `gemini-2.0-flash`)
- **Embeddings**: FastEmbed ONNX (`all-MiniLM-L6-v2`, <150MB RAM)
- **Vector Math**: NumPy
- **PDF Extraction**: pypdf

### Frontend
- Vanilla HTML / CSS / JavaScript
- PDF.js, KaTeX, Marked.js

---

## Getting Started

### Prerequisites
- Python 3.10+
- Google Gemini API key

### 1. Clone the Repository
```bash
git clone https://github.com/Codinggenie2004/NOVA-AI-Chatbot.git
cd NOVA-AI-Chatbot
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment
Create a `.env` file:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Run the Server
```bash
python app.py
```
Open `http://localhost:8000` in your browser.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Web interface |
| `POST` | `/api/upload` | Upload PDF (multipart/form-data with `file` and optional `session_id`) |
| `GET` | `/api/documents` | List session indexed documents (`?session_id=...`) |
| `GET` | `/api/documents/{filename}/file` | Serve PDF file (`?session_id=...`) |
| `GET` | `/api/documents/{filename}/summary` | Generate executive 4-part paper summary |
| `DELETE` | `/api/documents/{filename}` | Delete document from session |
| `DELETE` | `/api/documents` | Delete all documents in session |
| `POST` | `/api/chat` | Send question (SSE stream with citations) |
| `POST` | `/api/new-chat` | Start new session and purge previous data |
| `POST` | `/api/session/cleanup` | Wipe all session data immediately on exit |
| `POST` | `/api/session/ping` | Heartbeat keep-alive |

---

## Deployment

Deployable to Render, Heroku, or container hosts via `Procfile`:
```
web: uvicorn app:app --host 0.0.0.0 --port $PORT
```
Set `GEMINI_API_KEY` in your platform's environment variables.

---

## License

MIT License.
