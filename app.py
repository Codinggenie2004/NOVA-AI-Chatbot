"""
=============================================================================
RAG Research Chatbot — FastAPI Backend
Direct implementation of all 6 Phases from the Colab Research Notebook:
  - Phase 1: Multi-Document RAG Implementation (PDF parsing, 500-char chunking, all-MiniLM-L6-v2)
  - Phase 2: Source Tracking (Document name + Page number metadata)
  - Phase 3: Citation Generation (Structured source citations per answer)
  - Phase 4: Improving Retrieval Quality (Cosine similarity + 0.35 threshold filter)
  - Phase 5: Conversation Memory (Multi-turn session history & context preservation)
  - Phase 6: Advanced Prompt Engineering (Beginner, Research, Interview modes)
=============================================================================
"""

import os
import io
import json
import uuid
from typing import Optional

from dotenv import load_dotenv
import numpy as np
from pypdf import PdfReader
from sklearn.metrics.pairwise import cosine_similarity
from google import genai

from fastapi import FastAPI, UploadFile, File, HTTPException
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
TOP_K_CHUNKS = 5               # Phase 4: Top 5 retrieved chunks
SIMILARITY_THRESHOLD = 0.35    # Phase 4: Minimum cosine similarity threshold
GEMINI_MODEL = "gemini-3.6-flash"
EMBEDDING_MODEL = "gemini-embedding-001"
UPLOAD_DIR = "uploads"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs("static", exist_ok=True)

# Initialize Gemini Client (Handles both Embeddings & Chat Completion)
client = genai.Client(api_key=API_KEY)
print("[OK] Google Gemini Client & Embedding Engine ready.")

# ===========================================================================
# PHASE 1 & 2: In-Memory Stores & Source Tracking Metadata (Cell 8 + 9)
# ===========================================================================
# Chunks list storing text and Phase 2 metadata: [{"text": str, "doc": str, "page": int}]
chunks: list[dict] = []
# Dense vector embeddings matrix (N x 384)
chunk_embeddings: Optional[np.ndarray] = None
# List of indexed document names
documents: list[str] = []

# ===========================================================================
# PHASE 5: Conversation Memory Store (Cell 20)
# ===========================================================================
# Session-based multi-turn chat history: {session_id: [(question, answer), ...]}
chat_histories: dict[str, list[tuple[str, str]]] = {}

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
# PHASE 1: Multi-Document Ingestion & Chunking (Cell 8)
# ===========================================================================
def extract_and_chunk_pdf(file_bytes: bytes, filename: str) -> list[dict]:
    """
    Phase 1 & 2: Extract text page-by-page from PDF and split into 500-char chunks
    with source document name and page number attached to each chunk.
    """
    reader = PdfReader(io.BytesIO(file_bytes))
    new_chunks = []
    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for i in range(0, len(text), CHUNK_SIZE):
            piece = text[i : i + CHUNK_SIZE].strip()
            if piece:
                # Phase 2: Source Tracking Metadata
                new_chunks.append({
                    "text": piece,
                    "doc": filename,
                    "page": page_num
                })
    return new_chunks


def embed_texts(texts: list[str]) -> np.ndarray:
    """
    Phase 1: Generate dense vector embeddings using Google Gemini Embeddings API.
    Batches requests to stay within API payload limits.
    """
    if not texts:
        return np.empty((0, 3072))
    vectors = []
    for i in range(0, len(texts), 50):
        batch = texts[i : i + 50]
        res = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=batch
        )
        for emb in res.embeddings:
            vectors.append(emb.values)
    return np.array(vectors)


def embed_query(query: str) -> np.ndarray:
    """Generate embedding for search query using Google Gemini Embeddings API."""
    res = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=query
    )
    return np.array(res.embeddings[0].values)


def rebuild_embeddings():
    """
    Phase 1: Generate dense vector embeddings for all chunks using Google Gemini Embeddings API.
    """
    global chunk_embeddings
    if chunks:
        chunk_embeddings = embed_texts([c["text"] for c in chunks])
    else:
        chunk_embeddings = None


# ===========================================================================
# PHASE 4: Threshold-Based Retrieval & Quality Filtering (Cells 11 + 17)
# ===========================================================================
def retrieve_chunks(query: str, session_id: str = "") -> list[dict]:
    """
    Phase 4: Search top-k chunks using cosine similarity and filter by SIMILARITY_THRESHOLD (0.35).
    Includes contextual follow-up query fallback using conversation memory.
    """
    if chunk_embeddings is None or len(chunks) == 0:
        return []

    # Encode query and compute cosine similarity against all chunk embeddings
    query_vec = embed_query(query)
    scores = cosine_similarity([query_vec], chunk_embeddings)[0]
    top_indices = scores.argsort()[::-1][:TOP_K_CHUNKS]

    retrieved = []
    for rank, idx in enumerate(top_indices, start=1):
        # Phase 4 Threshold Filter (0.35)
        if scores[idx] >= SIMILARITY_THRESHOLD:
            # Phase 3: Citation Generation metadata
            retrieved.append({
                "text": chunks[idx]["text"],
                "doc": chunks[idx]["doc"],
                "page": chunks[idx]["page"],
                "rank": rank,
            })

    # Contextual fallback: If user asks a conversational follow-up ("explain again", "what did you say?"),
    # combine recent conversation memory to maintain relevant retrieval context
    history = chat_histories.get(session_id, [])
    if len(retrieved) < 2 and history:
        last_question = history[-1][0]
        fallback_vec = embed_query(f"{last_question} {query}")
        fb_scores = cosine_similarity([fallback_vec], chunk_embeddings)[0]
        for rank, idx in enumerate(fb_scores.argsort()[::-1][:TOP_K_CHUNKS], start=1):
            if fb_scores[idx] >= SIMILARITY_THRESHOLD:
                if not any(r["text"] == chunks[idx]["text"] for r in retrieved):
                    retrieved.append({
                        "text": chunks[idx]["text"],
                        "doc": chunks[idx]["doc"],
                        "page": chunks[idx]["page"],
                        "rank": len(retrieved) + 1,
                    })

    return retrieved[:TOP_K_CHUNKS]


def generate_document_insights(sample_chunks: list[dict], filename: str) -> list[str]:
    """Generate 3 starter exploration questions tailored to the uploaded document."""
    try:
        sample_text = "\n".join([c["text"] for c in sample_chunks[:8]])
        prompt = f"Based on this excerpt from '{filename}', generate exactly 3 engaging starter questions. Return JSON array of strings under key 'questions':\n{sample_text}"
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        text = resp.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        data = json.loads(text)
        return data.get("questions", data) if isinstance(data, list) else data.get("questions", [])
    except Exception:
        return [
            f"What are the main findings in {filename}?",
            f"Summarize the core methodology in {filename}.",
            f"What are the limitations discussed in {filename}?"
        ]

# ===========================================================================
# FastAPI Web Application & REST API Endpoints
# ===========================================================================
app = FastAPI(title="RAG Research Chatbot", version="2.0.0")
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
async def upload_document(file: UploadFile = File(...)):
    """
    Phase 1 & 2: Upload PDF, extract chunks, track source metadata, and rebuild embeddings.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    file_bytes = await file.read()
    
    # Save PDF locally for in-app PDF.js viewer
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as f:
        f.write(file_bytes)

    new_chunks = extract_and_chunk_pdf(file_bytes, file.filename)
    if not new_chunks:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail="Could not extract text from this PDF.")

    chunks.extend(new_chunks)
    if file.filename not in documents:
        documents.append(file.filename)

    rebuild_embeddings()
    suggested_questions = generate_document_insights(new_chunks, file.filename)

    return {
        "message": f"'{file.filename}' indexed successfully",
        "chunks_added": len(new_chunks),
        "total_chunks": len(chunks),
        "documents": documents,
        "suggested_questions": suggested_questions,
    }


@app.get("/api/documents")
async def list_documents():
    """List all indexed documents and chunk statistics."""
    return {"documents": documents, "total_chunks": len(chunks)}


@app.get("/api/documents/{filename}/file")
async def get_pdf_file(filename: str):
    """Serve PDF binary for in-app canvas rendering and page jumping."""
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(file_path, media_type="application/pdf", filename=filename)


@app.delete("/api/documents")
async def delete_all_documents():
    """Delete all documents from index and disk, then reset vector embeddings."""
    global chunks, chunk_embeddings, documents

    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            file_path = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                except Exception:
                    pass

    documents.clear()
    chunks.clear()
    chunk_embeddings = None

    return {"message": "All documents deleted successfully.", "documents": [], "total_chunks": 0}


@app.delete("/api/documents/{filename}")
async def delete_document(filename: str):
    """Delete a document from index and disk, then re-compute vector embeddings."""
    global chunks, documents

    if filename not in documents:
        raise HTTPException(status_code=404, detail="Document not found.")

    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass

    documents = [d for d in documents if d != filename]
    chunks = [c for c in chunks if c["doc"] != filename]
    rebuild_embeddings()

    return {"message": f"'{filename}' deleted.", "documents": documents, "total_chunks": len(chunks)}


@app.post("/api/chat")
@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    Unified RAG Endpoint covering:
      - Phase 3: Citation generation (structured source citations)
      - Phase 4: Threshold-based retrieval filtering
      - Phase 5: Conversation memory injection
      - Phase 6: Mode-based prompt selection
    """
    session_id = req.session_id or str(uuid.uuid4())
    mode = req.mode if req.mode in PROMPTS else "beginner"

    # Phase 4: Retrieve relevant chunks with threshold filtering
    retrieved = retrieve_chunks(req.question, session_id) if chunks else []

    if not chunks and session_id not in chat_histories:
        raise HTTPException(status_code=400, detail="Please upload a PDF document first.")

    # Format retrieved document context
    context_text = "\n\n".join([r["text"] for r in retrieved]) if retrieved else "(No direct document passage match. Answer using conversation history or general domain knowledge in character.)"
    
    # Phase 5: Build conversation memory history
    history_list = chat_histories.get(session_id, [])
    history_text = "\n".join([f"User: {q}\nAssistant: {a}" for q, a in history_list]) if history_list else "None."

    # Phase 6: Apply selected mode prompt template
    prompt_template = PROMPTS.get(mode, PROMPTS["beginner"])
    full_prompt = prompt_template.format(history=history_text, context=context_text, question=req.question)

    def event_generator():
        # Phase 3: Send structured citation metadata (doc + page + rank)
        yield f"data: {json.dumps({'type': 'metadata', 'sources': retrieved, 'session_id': session_id, 'mode': mode})}\n\n"

        # Stream response tokens in real-time
        full_answer = ""
        try:
            response_stream = client.models.generate_content_stream(model=GEMINI_MODEL, contents=full_prompt)
            for chunk in response_stream:
                if chunk.text:
                    full_answer += chunk.text
                    yield f"data: {json.dumps({'type': 'token', 'text': chunk.text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
            return

        # Phase 5: Append to session conversation memory
        if session_id not in chat_histories:
            chat_histories[session_id] = []
        chat_histories[session_id].append((req.question, full_answer))

        yield f"data: {json.dumps({'type': 'done', 'answer': full_answer})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/chat/clear")
async def clear_chat(session_id: str = ""):
    """Phase 5: Clear conversation memory for a given session."""
    if session_id in chat_histories:
        del chat_histories[session_id]
    return {"message": "Chat history cleared."}


@app.post("/api/new-chat")
async def start_new_chat(session_id: str = ""):
    """
    New Chat: Clear conversation memory for session and delete all present indexed files.
    """
    global chunks, chunk_embeddings, documents

    if session_id and session_id in chat_histories:
        del chat_histories[session_id]
    elif not session_id:
        chat_histories.clear()

    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            file_path = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                except Exception:
                    pass

    documents.clear()
    chunks.clear()
    chunk_embeddings = None

    return {
        "message": "New chat started and all present documents deleted.",
        "documents": [],
        "total_chunks": 0
    }


# ---------------------------------------------------------------------------
# Cloud-Ready Server Startup
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    # Dynamic port and host binding
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"\n[*] Server running at: http://localhost:{port} (or http://127.0.0.1:{port})\n")
    uvicorn.run("app:app", host=host, port=port, reload=False)
