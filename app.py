"""
=============================================================================
RAG Research Chatbot — Ephemeral FastAPI Backend (Render-Optimized)
Direct implementation of all 6 Phases from the Colab Research Notebook:
  - Phase 1: Multi-Document Ingestion (pypdf, 500-char chunks, fastembed all-MiniLM-L6-v2)
  - Phase 2: Source Tracking (Document name + Page number metadata)
  - Phase 3: Citation Generation (Structured source citations per answer)
  - Phase 4: Retrieval Quality (65% Dense Cosine + 35% BM25, 0.35 threshold filter)
  - Phase 5: Conversation Memory (Session history & contextual query expansion)
  - Phase 6: Prompt Engineering (Beginner, Research, Interview modes)
  - Ephemeral Zero-Retention: Per-session memory & auto-cleanup on close/inactivity
=============================================================================
"""

import os
import io
import json
import time
import uuid
import shutil
import asyncio
from typing import Optional

from dotenv import load_dotenv
import numpy as np
from pypdf import PdfReader
from fastembed import TextEmbedding
from google import genai

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Global Configuration
# ---------------------------------------------------------------------------
load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("GEMINI_API_KEY not found. Please set it in your .env file.")

CHUNK_SIZE = 500               # Phase 1: 500-character chunk size
CHUNK_OVERLAP = 100            # Option A: 100-character sliding window overlap
TOP_K_CHUNKS = 5               # Phase 4: Top 5 retrieved chunks
SIMILARITY_THRESHOLD = 0.35    # Phase 4: Minimum cosine similarity threshold
SESSION_TTL_SECONDS = 600      # 10 minutes inactivity auto-reaper for zero retention

GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs("static", exist_ok=True)

# Initialize lightweight ONNX embedding model (Phase 1: all-MiniLM-L6-v2)
print("[*] Initializing FastEmbed model (sentence-transformers/all-MiniLM-L6-v2)...")
embedding_model = TextEmbedding("sentence-transformers/all-MiniLM-L6-v2")
print("[OK] FastEmbed ONNX model ready (<150MB RAM).")

client = genai.Client(api_key=API_KEY)


def embed_texts(texts: list[str]) -> np.ndarray:
    """Batch embed text strings into 384-d float32 vectors via ONNX Runtime."""
    if not texts:
        return np.empty((0, 384), dtype=np.float32)
    return np.array(list(embedding_model.embed(texts)), dtype=np.float32)


def embed_query(query: str) -> np.ndarray:
    """Embed single query string into a 1D (384,) float32 vector."""
    return next(embedding_model.embed([query]))


# ===========================================================================
# Option C: BM25 Lexical Search Engine (Pure Python & Dependency-Free)
# ===========================================================================
import re
import math

def tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase alphanumeric words."""
    return re.findall(r"\w+", text.lower())

class SimpleBM25:
    """Fast, lightweight BM25Okapi ranking implementation."""
    def __init__(self, corpus: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus_size = len(corpus)
        self.doc_lens = [len(doc) for doc in corpus]
        self.avg_doc_len = sum(self.doc_lens) / self.corpus_size if self.corpus_size > 0 else 1.0
        self.doc_freqs = []
        self.nd: dict[str, int] = {}
        for doc in corpus:
            freqs = {}
            for word in doc:
                freqs[word] = freqs.get(word, 0) + 1
            self.doc_freqs.append(freqs)
            for word in freqs:
                self.nd[word] = self.nd.get(word, 0) + 1

        self.idf = {}
        for word, freq in self.nd.items():
            self.idf[word] = math.log((self.corpus_size - freq + 0.5) / (freq + 0.5) + 1.0)

    def get_scores(self, query_tokens: list[str]) -> np.ndarray:
        scores = np.zeros(self.corpus_size, dtype=np.float32)
        for q in query_tokens:
            if q not in self.idf:
                continue
            idf = self.idf[q]
            for idx, freqs in enumerate(self.doc_freqs):
                if q in freqs:
                    tf = freqs[q]
                    doc_len = self.doc_lens[idx]
                    score = idf * (tf * (self.k1 + 1)) / (tf + self.k1 * (1 - self.b + self.b * (doc_len / self.avg_doc_len)))
                    scores[idx] += score
        return scores


# ===========================================================================
# Zero-Retention Ephemeral Session Store
# ===========================================================================
# sessions: {session_id: {"chunks": [], "chunk_embeddings": np.ndarray, "bm25_index": SimpleBM25, "documents": [], "history": [], "last_active": float}}
sessions: dict[str, dict] = {}


def get_session(session_id: str = "") -> dict:
    """Retrieve active session state and purge any expired inactive sessions."""
    sid = session_id or "default"
    now = time.time()

    # Inactivity reaper: purge sessions untouched for > SESSION_TTL_SECONDS
    expired = [s for s, data in sessions.items() if s != "default" and now - data.get("last_active", 0) > SESSION_TTL_SECONDS]
    for exp_sid in expired:
        purge_session(exp_sid)

    if sid not in sessions:
        sessions[sid] = {
            "chunks": [],
            "chunk_embeddings": None,
            "bm25_index": None,
            "documents": [],
            "history": [],
            "last_active": now
        }
    else:
        sessions[sid]["last_active"] = now
    return sessions[sid]


def purge_session(session_id: str):
    """Erase all in-memory and on-disk files associated with a session."""
    sid = session_id or "default"
    sess_dir = os.path.join(UPLOAD_DIR, sid)
    if os.path.exists(sess_dir):
        shutil.rmtree(sess_dir, ignore_errors=True)
    sessions.pop(sid, None)


# ===========================================================================
# PHASE 6: Advanced Prompt Engineering & Mode Selection (Cell 24)
# ===========================================================================
PROMPTS = {
    # Mode 1: Beginner (simple language, analogies, no math/jargon, < 250 words)
    "beginner": """You are a friendly AI tutor. Use simple language, everyday analogies, and avoid heavy math/jargon. Keep answers under 250 words.
Conversation History:
{history}
Document Context:
{context}
User Question: {question}""",

    # Mode 2: Research (academic professor, technical precision, formulas, trade-offs, < 500 words)
    "research": """You are an expert AI/ML research professor. Use technical precision, explain formulas/mechanics, and discuss trade-offs. Keep answers under 500 words.
Conversation History:
{history}
Document Context:
{context}
User Question: {question}""",

    # Mode 3: Interview (concise candidate, structured summary, crisp bullet points, < 350 words)
    "interview": """You are a technical interview candidate & coach. Give structured, high-signal answers using summary points and clear bullet points. Keep answers under 350 words.
Conversation History:
{history}
Document Context:
{context}
User Question: {question}"""
}


# ===========================================================================
# PHASE 1: Multi-Document Ingestion & Chunking with Overlap (Option A)
# ===========================================================================
def extract_and_chunk_pdf(file_bytes: bytes, filename: str) -> list[dict]:
    """Phase 1 & 2 + Option A: Split PDF text into 500-char chunks with 100-char overlap."""
    reader = PdfReader(io.BytesIO(file_bytes))
    new_chunks = []
    step = max(50, CHUNK_SIZE - CHUNK_OVERLAP)

    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for i in range(0, len(text), step):
            piece = text[i : i + CHUNK_SIZE].strip()
            if piece and len(piece) > 25:
                new_chunks.append({
                    "text": piece,
                    "doc": filename,
                    "page": page_num
                })
    return new_chunks


def rebuild_index(sess: dict, new_chunks: list[dict] = None):
    """Rebuild or incrementally update dense embeddings matrix and BM25 index for a session."""
    if new_chunks:
        new_vecs = embed_texts([c["text"] for c in new_chunks])
        sess["chunk_embeddings"] = new_vecs if sess["chunk_embeddings"] is None or len(sess["chunks"]) == 0 else np.vstack([sess["chunk_embeddings"], new_vecs])
        sess["chunks"].extend(new_chunks)
    elif sess["chunks"]:
        sess["chunk_embeddings"] = embed_texts([c["text"] for c in sess["chunks"]])
    else:
        sess["chunk_embeddings"] = None
        sess["bm25_index"] = None
        return

    sess["bm25_index"] = SimpleBM25([tokenize(c["text"]) for c in sess["chunks"]])


def cosine_sim(matrix: np.ndarray, vector: np.ndarray) -> np.ndarray:
    """Compute cosine similarity between matrix (N, D) and vector (D,) using native NumPy."""
    mat_norm = np.linalg.norm(matrix, axis=1)
    vec_norm = np.linalg.norm(vector)
    if vec_norm == 0:
        return np.zeros(len(matrix), dtype=np.float32)
    return np.dot(matrix, vector) / (mat_norm * vec_norm + 1e-9)


# ===========================================================================
# PHASE 4 & Option C: Hybrid Retrieval (BM25 + Dense Cosine) & Confidence Scoring
# ===========================================================================
def retrieve_chunks(query: str, session_id: str = "") -> list[dict]:
    """Hybrid search combining Dense Cosine Vector Similarity (65%) and BM25 Keyword Matching (35%)."""
    sess = get_session(session_id)
    chunk_embeddings = sess["chunk_embeddings"]
    chunks = sess["chunks"]
    bm25_index = sess["bm25_index"]

    if chunk_embeddings is None or len(chunks) == 0:
        return []

    def _score_query(q: str):
        q_vec = embed_query(q)
        v_scores = cosine_sim(chunk_embeddings, q_vec)
        if bm25_index is not None:
            bm_raw = bm25_index.get_scores(tokenize(q))
            bm_max = np.max(bm_raw) if len(bm_raw) > 0 and np.max(bm_raw) > 0 else 1.0
            bm_norm = bm_raw / bm_max
        else:
            bm_norm = np.zeros(len(chunks), dtype=np.float32)
        return (0.65 * v_scores) + (0.35 * bm_norm), v_scores, bm_norm

    hybrid_scores, vec_scores, bm25_norm = _score_query(query)
    retrieved = []

    for rank, idx in enumerate(hybrid_scores.argsort()[::-1][:TOP_K_CHUNKS], start=1):
        if vec_scores[idx] >= SIMILARITY_THRESHOLD or bm25_norm[idx] >= 0.5:
            retrieved.append({
                "text": chunks[idx]["text"], "doc": chunks[idx]["doc"], "page": chunks[idx]["page"],
                "rank": rank, "score": round(float(hybrid_scores[idx]), 3),
                "confidence": min(98, max(20, int(round(float(hybrid_scores[idx]) * 100))))
            })

    # Contextual fallback: combine recent conversation memory for follow-up questions
    history = sess.get("history", [])
    if len(retrieved) < 2 and history:
        fb_hybrid, fb_vec, _ = _score_query(f"{history[-1][0]} {query}")
        for idx in fb_hybrid.argsort()[::-1][:TOP_K_CHUNKS]:
            if fb_vec[idx] >= SIMILARITY_THRESHOLD and not any(r["text"] == chunks[idx]["text"] for r in retrieved):
                retrieved.append({
                    "text": chunks[idx]["text"], "doc": chunks[idx]["doc"], "page": chunks[idx]["page"],
                    "rank": len(retrieved) + 1, "score": round(float(fb_hybrid[idx]), 3),
                    "confidence": min(98, max(20, int(round(float(fb_hybrid[idx]) * 100))))
                })

    return retrieved[:TOP_K_CHUNKS]


def call_gemini_json(prompt: str, fallback):
    """Query Gemini models in fallback order and extract parsed JSON."""
    for model_name in GEMINI_MODELS:
        try:
            resp = client.models.generate_content(model=model_name, contents=prompt)
            text = resp.text.strip()
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            return json.loads(text)
        except Exception:
            continue
    return fallback


def generate_document_insights(sample_chunks: list[dict], filename: str) -> list[str]:
    """Generate 3 starter exploration questions tailored to the uploaded document."""
    sample_text = "\n".join([c["text"] for c in sample_chunks[:8]])
    prompt = f"Based on this excerpt from '{filename}', generate exactly 3 engaging starter questions. Return JSON array of strings under key 'questions':\n{sample_text}"
    default = [
        f"What are the main findings in {filename}?",
        f"Summarize the core methodology in {filename}.",
        f"What are the limitations discussed in {filename}?"
    ]
    data = call_gemini_json(prompt, default)
    return data.get("questions", data) if isinstance(data, dict) else (data if isinstance(data, list) else default)


# ===========================================================================
# FastAPI Web Application & REST API Endpoints
# ===========================================================================
app = FastAPI(title="RAG Research Chatbot", version="2.1.0")
app.mount("/static", StaticFiles(directory="static"), name="static")

class ChatRequest(BaseModel):
    question: str
    mode: str = "beginner"
    session_id: str = ""


@app.get("/")
async def serve_index():
    """Serve frontend web interface."""
    return FileResponse("static/index.html")


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...), session_id: str = Form(default="")):
    """Phase 1 & 2: Upload PDF into session-scoped storage and incrementally embed with FastEmbed."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    sess = get_session(session_id)
    sid = session_id or "default"
    sess_dir = os.path.join(UPLOAD_DIR, sid)
    os.makedirs(sess_dir, exist_ok=True)

    try:
        file_bytes = await file.read()
        file_path = os.path.join(sess_dir, file.filename)
        with open(file_path, "wb") as f:
            f.write(file_bytes)

        new_chunks = await asyncio.to_thread(extract_and_chunk_pdf, file_bytes, file.filename)
        if not new_chunks:
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(status_code=400, detail="Could not extract text from this PDF. Ensure it contains selectable text.")

        if file.filename not in sess["documents"]:
            sess["documents"].append(file.filename)

        await asyncio.to_thread(rebuild_index, sess, new_chunks)
        suggested_questions = await asyncio.to_thread(generate_document_insights, new_chunks, file.filename)

        return {
            "message": f"'{file.filename}' indexed successfully",
            "chunks_added": len(new_chunks),
            "total_chunks": len(sess["chunks"]),
            "documents": sess["documents"],
            "suggested_questions": suggested_questions,
        }
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Upload processing failed: {str(err)}")


@app.get("/api/documents")
async def list_documents(session_id: str = ""):
    """List session-indexed documents and chunk statistics."""
    sess = get_session(session_id)
    return {"documents": sess["documents"], "total_chunks": len(sess["chunks"])}


@app.get("/api/documents/{filename}/file")
async def get_pdf_file(filename: str, session_id: str = ""):
    """Serve PDF binary for in-app canvas rendering and page jumping."""
    sid = session_id or "default"
    file_path = os.path.join(UPLOAD_DIR, sid, filename)
    if not os.path.exists(file_path):
        file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(file_path, media_type="application/pdf", filename=filename)


@app.get("/api/documents/{filename}/summary")
async def get_document_summary(filename: str, session_id: str = ""):
    """Option B: Generate a structured 4-part Executive Summary for uploaded paper."""
    sess = get_session(session_id)
    doc_chunks = [c["text"] for c in sess["chunks"] if c["doc"] == filename]
    if not doc_chunks:
        raise HTTPException(status_code=404, detail=f"No indexed content found for '{filename}'.")

    sampled = doc_chunks[:4] + (doc_chunks[len(doc_chunks) // 2 : len(doc_chunks) // 2 + 3] + doc_chunks[-3:] if len(doc_chunks) > 8 else [])
    sample_text = "\n\n".join(sampled[:10])

    prompt = f"""You are a senior AI research scientist. Provide a high-level executive breakdown for the research paper '{filename}' based on the provided text excerpt.
Return JSON with exactly these 4 keys:
1. "objective": "Problem statement, research goal, and hypothesis (2-3 concise sentences)",
2. "methodology": "Core technical approach, architecture, or experimental setup (2-3 concise sentences)",
3. "key_findings": "Key empirical metrics, insights, or breakthroughs (2-3 concise sentences)",
4. "limitations": "Known trade-offs, constraints, or open challenges (2 concise sentences)"

Excerpt:
{sample_text}"""

    default_summary = {
        "objective": f"Detailed research inquiry documented within '{filename}'.",
        "methodology": f"Empirical evaluation and document synthesis extracted from {len(doc_chunks)} chunks.",
        "key_findings": f"Core analytical arguments and results presented across document sections.",
        "limitations": f"Summary generated from document excerpts."
    }
    data = await asyncio.to_thread(call_gemini_json, prompt, default_summary)
    return {"filename": filename, "summary": data, "total_chunks": len(doc_chunks)}


@app.delete("/api/documents")
async def delete_all_documents(session_id: str = ""):
    """Delete all documents and vector embeddings for a given session."""
    purge_session(session_id or "default")
    return {"message": "All session documents deleted.", "documents": [], "total_chunks": 0}


@app.delete("/api/documents/{filename}")
async def delete_document(filename: str, session_id: str = ""):
    """Delete a document from session index and disk."""
    sess = get_session(session_id)
    sid = session_id or "default"
    if filename not in sess["documents"]:
        raise HTTPException(status_code=404, detail="Document not found.")

    file_path = os.path.join(UPLOAD_DIR, sid, filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass

    sess["documents"] = [d for d in sess["documents"] if d != filename]
    sess["chunks"] = [c for c in sess["chunks"] if c["doc"] != filename]
    await asyncio.to_thread(rebuild_index, sess)
    return {"message": f"'{filename}' deleted.", "documents": sess["documents"], "total_chunks": len(sess["chunks"])}


@app.post("/api/chat")
@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    Unified RAG Endpoint:
      - Phase 3: Structured citations (doc + page + rank)
      - Phase 4: Cosine + BM25 hybrid threshold filtering
      - Phase 5: Session conversation memory injection
      - Phase 6: Mode-based prompt selection
    """
    session_id = req.session_id or "default"
    sess = get_session(session_id)
    mode = req.mode if req.mode in PROMPTS else "beginner"

    retrieved = retrieve_chunks(req.question, session_id) if sess["chunks"] else []

    if not sess["chunks"] and not sess["history"]:
        raise HTTPException(status_code=400, detail="Please upload a PDF document first.")

    context_text = "\n\n".join([r["text"] for r in retrieved]) if retrieved else "(No direct document passage match. Answer using conversation history or general domain knowledge in character.)"
    
    history_list = sess.get("history", [])
    history_text = "\n".join([f"User: {q}\nAssistant: {a}" for q, a in history_list]) if history_list else "None."

    prompt_template = PROMPTS.get(mode, PROMPTS["beginner"])
    full_prompt = prompt_template.format(history=history_text, context=context_text, question=req.question)

    def event_generator():
        yield f"data: {json.dumps({'type': 'metadata', 'sources': retrieved, 'session_id': session_id, 'mode': mode})}\n\n"

        full_answer = ""
        streamed_successfully = False
        last_err = None

        for model_name in GEMINI_MODELS:
            try:
                response_stream = client.models.generate_content_stream(model=model_name, contents=full_prompt)
                for chunk in response_stream:
                    if chunk.text:
                        full_answer += chunk.text
                        yield f"data: {json.dumps({'type': 'token', 'text': chunk.text})}\n\n"
                streamed_successfully = True
                break
            except Exception as e:
                print(f"[!] Chat streaming error with '{model_name}': {e}. Trying fallback model...")
                last_err = e
                if full_answer:
                    break
                continue

        if not streamed_successfully and not full_answer:
            yield f"data: {json.dumps({'type': 'error', 'error': f'The AI model is temporarily under high demand. Please try sending your message again in a moment. ({str(last_err)})'})}\n\n"
            return

        sess["history"].append((req.question, full_answer))
        yield f"data: {json.dumps({'type': 'done', 'answer': full_answer})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/chat/clear")
async def clear_chat(session_id: str = ""):
    """Clear conversation history for a session."""
    sess = get_session(session_id)
    sess["history"].clear()
    return {"message": "Chat history cleared."}


@app.post("/api/new-chat")
async def start_new_chat(session_id: str = ""):
    """Zero-retention reset: Purge all session files, chunks, embeddings, and chat history."""
    purge_session(session_id or "default")
    return {"message": "New chat started and all session data purged.", "documents": [], "total_chunks": 0}


@app.post("/api/session/cleanup")
@app.get("/api/session/cleanup")
async def session_cleanup(session_id: str = ""):
    """Ephemeral beacon endpoint: Purges all data immediately when user closes the browser tab."""
    purge_session(session_id or "default")
    return {"message": "Session data wiped."}


@app.post("/api/session/ping")
async def session_ping(session_id: str = ""):
    """Heartbeat endpoint to maintain session liveness while tab is open."""
    get_session(session_id)
    return {"status": "alive"}


# ---------------------------------------------------------------------------
# Cloud & Render Startup
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"\n[*] Server running at: http://localhost:{port} (or http://127.0.0.1:{port})\n")
    uvicorn.run("app:app", host=host, port=port, reload=False)
