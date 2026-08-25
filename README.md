# 🧠 NOVA — AI-Powered Research Assistant

> **Upload PDFs. Ask Questions. Get Cited Answers.**

A full-stack **Retrieval-Augmented Generation (RAG)** chatbot that lets you upload research PDFs, ask questions in natural language, and receive accurate, citation-backed answers with real-time streaming — powered by **Google Gemini** and **sentence-transformers**.

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688?logo=fastapi&logoColor=white)
![Gemini](https://img.shields.io/badge/Google_Gemini-AI-4285F4?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

🔹 **Multi-Document RAG** — Upload multiple PDFs; text is extracted, chunked (500 chars), and embedded with `all-MiniLM-L6-v2`

🔹 **Smart Retrieval** — Cosine similarity search with a `0.35` threshold returns only the most relevant passages

🔹 **Source Citations** — Every answer includes document name, page number, and relevance rank

🔹 **Conversation Memory** — Multi-turn session history preserves context across follow-up questions

🔹 **3 Response Modes** — 🌱 Beginner (simple analogies) · 🔬 Research (technical depth) · 🎯 Interview (bullet points)

🔹 **Real-Time Streaming** — Token-by-token response via Server-Sent Events (SSE)

🔹 **Math Rendering** — KaTeX integration for LaTeX formulas and expressions

🔹 **Voice Input & Read Aloud** — Speak your questions and listen to AI responses

🔹 **In-App PDF Viewer** — PDF.js-powered viewer with zoom, page navigation, and citation-linked page jumping

🔹 **AI Starter Questions** — Auto-generated exploration questions tailored to each uploaded document

🔹 **Export Chat** — Download conversations as Markdown files

🔹 **Premium Dark UI** — Glassmorphism design with gradients, animations, and full mobile responsiveness

---

## 🏗️ Architecture — The 6 RAG Phases

This project implements the complete RAG research pipeline:

| Phase | Name | What It Does |
|:-----:|------|--------------|
| **1** | Multi-Document Ingestion | PDF text extraction via `pypdf`, split into 500-char chunks |
| **2** | Source Tracking | Each chunk stores `{ text, document_name, page_number }` metadata |
| **3** | Citation Generation | Structured citations (doc + page + rank) returned with every answer |
| **4** | Retrieval Quality | Cosine similarity with `all-MiniLM-L6-v2`, top-5 results, 0.35 threshold filter |
| **5** | Conversation Memory | Session-based multi-turn chat history with contextual follow-up fallback |
| **6** | Prompt Engineering | 3 mode-specific prompt templates with history + context injection |

---

## 🛠️ Tech Stack

### Backend

| Technology | Purpose |
|------------|---------|
| [FastAPI](https://fastapi.tiangolo.com/) | Async Python web framework |
| [Google Gemini](https://ai.google.dev/) (`gemini-3.6-flash`) | LLM for answer generation |
| [Sentence Transformers](https://www.sbert.net/) (`all-MiniLM-L6-v2`) | Dense vector embeddings |
| [scikit-learn](https://scikit-learn.org/) | Cosine similarity computation |
| [pypdf](https://pypdf.readthedocs.io/) | PDF text extraction |
| [Uvicorn](https://www.uvicorn.org/) | ASGI server |

### Frontend

| Technology | Purpose |
|------------|---------|
| Vanilla HTML / CSS / JS | Zero-dependency frontend |
| [PDF.js](https://mozilla.github.io/pdf.js/) | In-app PDF rendering |
| [KaTeX](https://katex.org/) | LaTeX math rendering |
| [Marked](https://marked.js.org/) | Markdown → HTML parsing |
| Web Speech API | Voice input & text-to-speech |

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- A [Google Gemini API key](https://aistudio.google.com/apikey)

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/Codinggenie2004/NOVA-AI-Chatbot.git
cd NOVA-AI-Chatbot
```

### 2️⃣ Install Dependencies

```bash
pip install -r requirements.txt
```

### 3️⃣ Set Up Environment Variables

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4️⃣ Run the Application

```bash
python app.py
```

Open **http://localhost:8000** in your browser and start uploading PDFs!

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve the frontend UI |
| `POST` | `/api/upload` | Upload a PDF for indexing |
| `GET` | `/api/documents` | List all indexed documents |
| `GET` | `/api/documents/{filename}/file` | Serve PDF for in-app viewing |
| `DELETE` | `/api/documents/{filename}` | Remove a document from index |
| `POST` | `/api/chat` | Send a question (SSE streaming) |
| `POST` | `/api/chat/clear?session_id=...` | Clear session history |

### Request Body (`/api/chat`)

```json
{
  "question": "What are the main findings?",
  "mode": "beginner",
  "session_id": "optional-uuid"
}
```

> **Modes:** `beginner` · `research` · `interview`

---

## 📁 Project Structure

```
NOVA-AI-Chatbot/
├── app.py                 # FastAPI backend with all 6 RAG phases
├── requirements.txt       # Python dependencies
├── Procfile               # Cloud deployment config
├── .env                   # API keys (not tracked in git)
├── .gitignore
└── static/
    ├── index.html         # Frontend UI
    ├── index.css          # Premium dark theme
    └── app.js             # Frontend logic
```

---

## ☁️ Deployment

Cloud-ready with a `Procfile` for **Heroku**, **Render**, or similar platforms:

```
web: uvicorn app:app --host 0.0.0.0 --port $PORT
```

Set `GEMINI_API_KEY` as an environment variable in your cloud platform's dashboard.

---

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/Codinggenie2004">Codinggenie2004</a>
</p>
