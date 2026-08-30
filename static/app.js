/**
 * RAG Chatbot — Complete Frontend Application Logic
 *
 * Capabilities:
 * - In-App PDF.js Viewer with Page Jumping & Zoom
 * - Voice Input (Speech-to-Text) & Audio Read-Aloud (Text-to-Speech)
 * - Multi-Chat Sessions (Sidebar Threads) with localStorage persistence
 * - Document Management (Upload with Multi-Stage Indexing Progress + Delete Document)
 * - Real-Time Streaming AI Responses with KaTeX Math & Markdown Rendering
 * - Clean Citations (No similarity score shown) with Passage & PDF Viewer Modals
 */

// Configure PDF.js Worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------
const state = {
  sessionId: localStorage.getItem('rag_active_session_id') || crypto.randomUUID(),
  threads: JSON.parse(localStorage.getItem('rag_threads') || '[]'),
  currentMode: 'beginner',
  documents: [],
  isLoading: false,
  hasMessages: false,
  suggestedQuestions: [],
  sourcesStore: new Map(),
  // PDF viewer state
  currentPdfDoc: null,
  currentPdfName: '',
  currentPdfPage: 1,
  totalPdfPages: 1,
  pdfScale: 1.3,
  // Voice & Speech state
  isRecording: false,
  recognition: null,
  activeSpeechUtterance: null,
};

// Initialize active thread
if (state.threads.length === 0) {
  const defaultThread = {
    id: state.sessionId,
    title: 'Chat',
    messages: [],
    created: Date.now(),
  };
  state.threads.push(defaultThread);
  saveThreads();
} else {
  const activeExists = state.threads.some((t) => t.id === state.sessionId);
  if (!activeExists) {
    state.sessionId = state.threads[0].id;
  }
}
localStorage.setItem('rag_active_session_id', state.sessionId);

function saveThreads() {
  localStorage.setItem('rag_threads', JSON.stringify(state.threads));
}

function getActiveThread() {
  return state.threads.find((t) => t.id === state.sessionId) || state.threads[0];
}

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Sidebar & Navigation
const tabChats = $('#tab-chats');
const tabDocs = $('#tab-docs');
const panelChats = $('#panel-chats');
const panelDocs = $('#panel-docs');
const newChatBtn = $('#new-chat-btn');
const sidebarNewChatBtn = $('#sidebar-new-chat-btn');
const headerNewChatBtn = $('#header-new-chat-btn');
const threadsList = $('#threads-list');
const activeChatTitle = $('#active-chat-title');
const clearBtn = $('#clear-btn');

// Upload & Documents
const uploadZone = $('#upload-zone');
const uploadInput = $('#upload-input');
const uploadProgress = $('#upload-progress');
const progressBarFill = $('#progress-bar-fill');
const progressText = $('#progress-text');
const stageUpload = $('#stage-upload');
const stageChunk = $('#stage-chunk');
const stageEmbed = $('#stage-embed');
const stageInsights = $('#stage-insights');
const documentList = $('#document-list');
const noDocuments = $('#no-documents');

// Header & Status
const headerStatusText = $('#header-status-text');
const modeSelector = $('#mode-selector');
const exportChatBtn = $('#export-chat-btn');
const toastContainer = $('#toast-container');

// Chat Area & Input
const chatArea = $('#chat-area');
const welcomeState = $('#welcome-state');
const suggestionsWrapper = $('#suggestions-wrapper');
const suggestionsChips = $('#suggestions-chips');
const chatInput = $('#chat-input');
const sendBtn = $('#send-btn');
const voiceBtn = $('#voice-btn');

// Source Passage Modal
const sourceModal = $('#source-modal');
const modalSourceRank = $('#modal-source-rank');
const modalDocTitle = $('#modal-doc-title');
const modalMeta = $('#modal-meta');
const modalPassageText = $('#modal-passage-text');
const modalCloseBtn = $('#modal-close-btn');
const modalDoneBtn = $('#modal-done-btn');
const modalCopyBtn = $('#modal-copy-btn');
const modalViewPdfBtn = $('#modal-view-pdf-btn');

// In-App PDF Viewer Modal (PDF.js)
const pdfModal = $('#pdf-modal');
const pdfDocTitle = $('#pdf-doc-title');
const pdfCurrentPageEl = $('#pdf-current-page');
const pdfTotalPagesEl = $('#pdf-total-pages');
const pdfPageBadge = $('#pdf-page-badge');
const pdfPrevBtn = $('#pdf-prev-btn');
const pdfNextBtn = $('#pdf-next-btn');
const pdfZoomInBtn = $('#pdf-zoom-in-btn');
const pdfZoomOutBtn = $('#pdf-zoom-out-btn');
const pdfCloseBtn = $('#pdf-close-btn');
const pdfCanvas = $('#pdf-canvas');
const pdfLoading = $('#pdf-loading');

// ---------------------------------------------------------------------------
// Toast Notifications
// ---------------------------------------------------------------------------
function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---------------------------------------------------------------------------
// Mobile Sidebar Drawer Controls
// ---------------------------------------------------------------------------
const sidebarEl = $('#sidebar');
const mobileMenuBtn = $('#mobile-menu-btn');
const sidebarCloseBtn = $('#sidebar-close-btn');
const sidebarOverlay = $('#sidebar-overlay');

function openMobileSidebar() {
  if (sidebarEl) sidebarEl.classList.add('open');
  if (sidebarOverlay) sidebarOverlay.classList.add('active');
}

function closeMobileSidebar() {
  if (sidebarEl) sidebarEl.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');
}

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', openMobileSidebar);
}
if (sidebarCloseBtn) {
  sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
}
if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeMobileSidebar);
}

// ---------------------------------------------------------------------------
// Sidebar Tabs: Chats vs Documents
// ---------------------------------------------------------------------------
if (tabChats && tabDocs) {
  tabChats.addEventListener('click', () => switchSidebarTab('chats'));
  tabDocs.addEventListener('click', () => switchSidebarTab('docs'));
}

function switchSidebarTab(tab) {
  if (!tabChats || !tabDocs || !panelChats || !panelDocs) return;
  if (tab === 'chats') {
    tabChats.classList.add('active');
    tabDocs.classList.remove('active');
    panelChats.style.display = 'flex';
    panelDocs.style.display = 'none';
  } else {
    tabDocs.classList.add('active');
    tabChats.classList.remove('active');
    panelDocs.style.display = 'flex';
    panelChats.style.display = 'none';
  }
}

const clearAllChatsBtn = $('#clear-all-chats-btn');

// ---------------------------------------------------------------------------
// Multi-Chat Sessions (Sidebar Threads)
// ---------------------------------------------------------------------------
function renderThreads() {
  if (!threadsList) return;
  threadsList.innerHTML = '';

  if (!state.threads || state.threads.length === 0) {
    threadsList.innerHTML = `
      <li class="no-threads">
        <span>💬</span>
        No recent chats
      </li>
    `;
    if (activeChatTitle) activeChatTitle.textContent = 'NOVA Chat';
    return;
  }

  state.threads.forEach((thread) => {
    const li = document.createElement('li');
    li.className = `thread-item ${thread.id === state.sessionId ? 'active' : ''}`;
    li.dataset.threadId = thread.id;

    li.innerHTML = `
      <span class="thread-title" title="Click to open · Double-click to rename">${escapeHtml(thread.title)}</span>
      <div class="thread-actions">
        <button class="thread-action-btn thread-rename-btn" title="Rename chat">✏️</button>
        <button class="thread-action-btn thread-delete-btn" title="Delete chat">🗑️</button>
      </div>
    `;

    const titleSpan = li.querySelector('.thread-title');
    const renameBtn = li.querySelector('.thread-rename-btn');
    const deleteBtn = li.querySelector('.thread-delete-btn');

    // Click to select thread
    li.addEventListener('click', (e) => {
      if (e.target.closest('.thread-actions') || e.target.tagName === 'INPUT') return;
      switchThread(thread.id);
    });

    // Rename button or double-click to start inline editing
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineRename(li, thread);
    });

    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(li, thread);
    });

    // Delete single thread
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteThread(thread.id);
    });

    threadsList.appendChild(li);
  });

  const active = getActiveThread();
  if (activeChatTitle && active) {
    activeChatTitle.textContent = active.title;
  }
}

function startInlineRename(li, thread) {
  const titleSpan = li.querySelector('.thread-title');
  if (!titleSpan) return;

  const currentTitle = thread.title;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'thread-title-input';
  input.value = currentTitle;

  const finishRename = () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      renameThread(thread.id, newTitle);
    } else {
      renderThreads();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishRename();
    } else if (e.key === 'Escape') {
      renderThreads();
    }
  });

  input.addEventListener('blur', finishRename);

  titleSpan.replaceWith(input);
  input.focus();
  input.select();
}

function renameThread(threadId, newTitle) {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return;

  thread.title = newTitle;
  saveThreads();
  renderThreads();

  if (state.sessionId === threadId && activeChatTitle) {
    activeChatTitle.textContent = newTitle;
  }

  showToast(`Chat renamed to "${newTitle}"`, 'info', 2000);
}
window.renameThread = renameThread;

async function startNewChat() {
  // Stop active speech synthesis & voice recording
  stopReadAloud();
  stopRecording();

  try {
    // Call backend endpoint to reset conversation memory and delete all uploaded documents
    await fetch(`/api/new-chat?session_id=${encodeURIComponent(state.sessionId)}`, {
      method: 'POST',
    });
  } catch (err) {
    console.warn('Backend reset error:', err);
    try {
      await fetch('/api/documents', { method: 'DELETE' });
      await fetch(`/api/chat/clear?session_id=${encodeURIComponent(state.sessionId)}`, { method: 'POST' });
    } catch (e) {
      console.warn('Fallback reset error:', e);
    }
  }

  // Create brand new session ID
  const newId = crypto.randomUUID();
  state.sessionId = newId;
  localStorage.setItem('rag_active_session_id', newId);

  // Reset thread list to new fresh conversation
  const newThread = {
    id: newId,
    title: 'Chat',
    messages: [],
    created: Date.now(),
  };
  state.threads = [newThread];
  saveThreads();

  // Reset document & memory state
  state.documents = [];
  state.suggestedQuestions = [];
  state.sourcesStore.clear();
  state.isLoading = false;
  state.hasMessages = false;

  // Reset input field
  if (chatInput) {
    chatInput.value = '';
    chatInput.style.height = 'auto';
  }
  if (sendBtn) sendBtn.disabled = true;

  // Refresh UI elements
  renderDocuments();
  updateStatus();
  renderThreads();
  renderWelcomeState();

  const bar = $('#chat-suggestions-bar');
  if (bar) bar.style.display = 'none';

  // Close modals & mobile sidebar if open
  closeSourceModal();
  closePdfViewer();
  closeMobileSidebar();

  showToast('New chat started & all documents cleared ✨', 'success', 2500);
}
window.startNewChat = startNewChat;

// Attach New Chat handlers
if (newChatBtn) {
  newChatBtn.addEventListener('click', startNewChat);
}
if (sidebarNewChatBtn) {
  sidebarNewChatBtn.addEventListener('click', startNewChat);
}
if (headerNewChatBtn) {
  headerNewChatBtn.addEventListener('click', startNewChat);
}

if (clearAllChatsBtn) {
  clearAllChatsBtn.addEventListener('click', () => {
    if (!state.threads || state.threads.length === 0) {
      showToast('No recent chats to remove.', 'info', 2000);
      return;
    }

    if (!confirm('Are you sure you want to remove ALL recent chats? This cannot be undone.')) {
      return;
    }

    // Clear backend chat history sessions if any
    state.threads.forEach((t) => {
      fetch(`/api/chat/clear?session_id=${t.id}`, { method: 'POST' }).catch(() => {});
    });

    state.threads = [];
    localStorage.removeItem('rag_threads');
    localStorage.removeItem('rag_active_session_id');
    state.sessionId = crypto.randomUUID();

    stopReadAloud();
    renderThreads();
    loadThreadMessages();

    showToast('All recent chats removed 🗑️', 'success', 2500);
  });
}

function switchThread(threadId) {
  state.sessionId = threadId;
  localStorage.setItem('rag_active_session_id', threadId);

  // Stop any active speech
  stopReadAloud();

  renderThreads();
  loadThreadMessages();
}

function deleteThread(threadId) {
  state.threads = state.threads.filter((t) => t.id !== threadId);
  fetch(`/api/chat/clear?session_id=${threadId}`, { method: 'POST' }).catch(() => {});

  if (state.threads.length === 0) {
    localStorage.removeItem('rag_threads');
    localStorage.removeItem('rag_active_session_id');
    state.sessionId = crypto.randomUUID();
  } else if (state.sessionId === threadId) {
    state.sessionId = state.threads[0].id;
    localStorage.setItem('rag_active_session_id', state.sessionId);
  }

  saveThreads();
  renderThreads();
  loadThreadMessages();
  showToast('Chat deleted', 'info', 2000);
}

function loadThreadMessages() {
  const thread = getActiveThread();
  chatArea.innerHTML = '';

  if (!thread || !thread.messages || thread.messages.length === 0) {
    state.hasMessages = false;
    renderWelcomeState();
    return;
  }

  state.hasMessages = true;
  thread.messages.forEach((msg) => {
    if (msg.role === 'user') {
      renderUserMessageElement(msg.text);
    } else {
      renderBotMessageElement(msg.text, msg.sources, msg.id);
    }
  });

  scrollToBottom();
}

function renderWelcomeState() {
  chatArea.innerHTML = `
    <div class="welcome-state" id="welcome-state">
      <span class="welcome-icon">🤖</span>
      <h1 class="welcome-title">Your AI Research Assistant</h1>
      <p class="welcome-subtitle">
        Upload your PDF documents, choose a response mode, and ask questions.
        I'll retrieve the most relevant context and generate accurate, cited answers with real-time streaming and math notation.
      </p>
      <div class="welcome-steps">
        <div class="welcome-step">
          <span class="welcome-step-icon">📤</span>
          <span class="welcome-step-label">Upload PDFs</span>
        </div>
        <div class="welcome-step">
          <span class="welcome-step-icon">🎛️</span>
          <span class="welcome-step-label">Pick a Mode</span>
        </div>
        <div class="welcome-step">
          <span class="welcome-step-icon">💬</span>
          <span class="welcome-step-label">Ask Questions</span>
        </div>
      </div>
      <div class="suggestions-wrapper" id="suggestions-wrapper" style="${state.suggestedQuestions.length ? 'display: block;' : 'display: none;'}">
        <div class="suggestions-title">💡 Suggested Questions for Your Documents</div>
        <div class="suggestions-chips" id="suggestions-chips"></div>
      </div>
    </div>
  `;

  if (state.suggestedQuestions.length > 0) {
    renderSuggestions(state.suggestedQuestions);
  }
}

// ---------------------------------------------------------------------------
// PDF Upload with Multi-Stage Progress
// ---------------------------------------------------------------------------
if (uploadInput) {
  uploadInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) {
      handleFiles(Array.from(e.target.files));
    }
  });
}

if (uploadZone) {

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');

    const rawFiles = Array.from(e.dataTransfer.files);
    const pdfFiles = rawFiles.filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
    );

    if (pdfFiles.length > 0) {
      handleFiles(pdfFiles);
    } else {
      showToast('Please drop valid .pdf document files.', 'error');
    }
  });
}

async function handleFiles(files) {
  for (const file of files) {
    await uploadFile(file);
  }
}

function setProgress(text, percent) {
  if (progressBarFill) progressBarFill.style.width = `${percent}%`;
  if (progressText) progressText.textContent = text;
}

async function uploadFile(file) {
  uploadProgress.classList.add('active');
  setProgress(`Uploading ${file.name}...`, 35);

  const timer1 = setTimeout(() => setProgress('Generating AI summary...', 75), 1200);

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    clearTimeout(timer1);

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Upload failed');
    }

    const data = await res.json();

    setProgress(`Uploaded successfully!`, 100);

    state.documents = data.documents;
    renderDocuments();
    updateStatus();

    if (data.suggested_questions && data.suggested_questions.length > 0) {
      state.suggestedQuestions = data.suggested_questions;
      renderSuggestions(data.suggested_questions);
    }

    showToast(`${file.name} uploaded successfully`, 'success');
  } catch (err) {
    clearTimeout(timer1);
    if (progressBarFill) progressBarFill.style.width = '0%';
    if (progressText) progressText.textContent = `❌ Upload failed`;
    showToast(err.message, 'error');
  }

  setTimeout(() => {
    uploadProgress.classList.remove('active');
  }, 2200);

  uploadInput.value = '';
}

function renderDocuments() {
  if (state.documents.length === 0) {
    noDocuments.style.display = '';
    return;
  }

  noDocuments.style.display = 'none';
  documentList.querySelectorAll('.document-item').forEach((el) => el.remove());

  state.documents.forEach((doc) => {
    const li = document.createElement('li');
    li.className = 'document-item';
    li.innerHTML = `
      <span class="doc-icon" style="cursor: pointer;" title="Click to view PDF" onclick="openPdfViewer('${escapeHtml(doc)}', 1)">📄</span>
      <span class="doc-name" style="cursor: pointer;" title="Click to view PDF" onclick="openPdfViewer('${escapeHtml(doc)}', 1)">${escapeHtml(doc)}</span>
      <button class="doc-delete-btn" title="Delete document" onclick="deleteDocument('${escapeHtml(doc)}')">🗑️</button>
    `;
    documentList.appendChild(li);
  });
}

async function deleteDocument(filename) {
  if (!confirm(`Are you sure you want to delete '${filename}'?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to delete document');
    }

    const data = await res.json();
    state.documents = data.documents || [];
    renderDocuments();
    updateStatus();

    showToast(`'${filename}' deleted`, 'info', 2500);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.deleteDocument = deleteDocument;

function updateStatus() {
  if (state.documents.length > 0) {
    headerStatusText.textContent = `${state.documents.length} document${state.documents.length > 1 ? 's' : ''} loaded — ask away!`;
  } else {
    headerStatusText.textContent = 'Ready — upload documents to start';
  }
}

// ---------------------------------------------------------------------------
// Suggested Questions
// ---------------------------------------------------------------------------
function renderSuggestions(questions) {
  if (!questions || questions.length === 0) return;

  const chipsContainer = $('#suggestions-chips');
  const barContainer = $('#bar-chips');

  if (chipsContainer) {
    chipsContainer.innerHTML = '';
    questions.forEach((q) => {
      const chip = document.createElement('button');
      chip.className = 'suggestion-chip';
      chip.innerHTML = `✨ <span>${escapeHtml(q)}</span>`;
      chip.addEventListener('click', () => askQuestionDirectly(q));
      chipsContainer.appendChild(chip);
    });
    if ($('#suggestions-wrapper')) $('#suggestions-wrapper').style.display = 'block';
  }

  if (barContainer && chatSuggestionsBar) {
    chatSuggestionsBar.style.display = 'flex';
    barContainer.innerHTML = '';
    questions.forEach((q) => {
      const chip = document.createElement('button');
      chip.className = 'bar-chip';
      chip.textContent = q;
      chip.addEventListener('click', () => askQuestionDirectly(q));
      barContainer.appendChild(chip);
    });
  }
}

function askQuestionDirectly(questionText) {
  chatInput.value = questionText;
  sendMessage();
}

// ---------------------------------------------------------------------------
// Mode Selector
// ---------------------------------------------------------------------------
modeSelector.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;

  $$('.mode-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.currentMode = btn.dataset.mode;

  showToast(`Mode: ${btn.textContent.trim()}`, 'info', 2000);
});

// ---------------------------------------------------------------------------
// Chat Input Controls
// ---------------------------------------------------------------------------
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  sendBtn.disabled = !chatInput.value.trim();
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (chatInput.value.trim() && !state.isLoading) {
      sendMessage();
    }
  }
});

sendBtn.addEventListener('click', () => {
  if (chatInput.value.trim() && !state.isLoading) {
    sendMessage();
  }
});

// ---------------------------------------------------------------------------
// Voice Input (Web Speech API)
// ---------------------------------------------------------------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  state.recognition = new SpeechRecognition();
  state.recognition.continuous = false;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';

  state.recognition.onstart = () => {
    state.isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.title = 'Listening... Speak now (Click to stop)';
    showToast('🎙️ Listening... Speak your question', 'info', 2000);
  };

  state.recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !chatInput.value.trim();
  };

  state.recognition.onerror = (event) => {
    console.warn('Voice error:', event.error);
    stopRecording();
    showToast(`Voice input: ${event.error}`, 'error');
  };

  state.recognition.onend = () => {
    stopRecording();
  };
}

function startRecording() {
  if (!state.recognition) {
    showToast('Voice input is not supported in this browser.', 'error');
    return;
  }
  try {
    state.recognition.start();
  } catch (e) {
    console.warn(e);
  }
}

function stopRecording() {
  state.isRecording = false;
  voiceBtn.classList.remove('recording');
  voiceBtn.title = 'Speak question (Voice Input)';
  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (e) {}
  }
}

voiceBtn.addEventListener('click', () => {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// ---------------------------------------------------------------------------
// Audio Read-Aloud (Text-to-Speech)
// ---------------------------------------------------------------------------
function toggleReadAloud(msgId) {
  if (state.activeSpeechUtterance && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    $$('.read-aloud-btn').forEach((b) => {
      b.classList.remove('speaking');
      b.innerHTML = '🔊 Listen';
    });
    state.activeSpeechUtterance = null;
    return;
  }

  const bubble = $(`#${msgId}-bubble`);
  if (!bubble) return;

  const btn = $(`#${msgId}-actions .read-aloud-btn`);
  const rawText = bubble.innerText;

  if (!rawText.trim()) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(rawText);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onstart = () => {
    state.activeSpeechUtterance = utterance;
    if (btn) {
      btn.classList.add('speaking');
      btn.innerHTML = '⏹ Stop';
    }
  };

  utterance.onend = () => {
    state.activeSpeechUtterance = null;
    if (btn) {
      btn.classList.remove('speaking');
      btn.innerHTML = '🔊 Listen';
    }
  };

  utterance.onerror = () => {
    state.activeSpeechUtterance = null;
    if (btn) {
      btn.classList.remove('speaking');
      btn.innerHTML = '🔊 Listen';
    }
  };

  window.speechSynthesis.speak(utterance);
}
window.toggleReadAloud = toggleReadAloud;

function stopReadAloud() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  $$('.read-aloud-btn').forEach((b) => {
    b.classList.remove('speaking');
    b.innerHTML = '🔊 Listen';
  });
}

// ---------------------------------------------------------------------------
// Chat Messaging & Real-Time Streaming
// ---------------------------------------------------------------------------
function hideWelcome() {
  const el = $('#welcome-state');
  if (el) {
    el.style.display = 'none';
    state.hasMessages = true;
  }
}

function renderUserMessageElement(text) {
  hideWelcome();
  const msgEl = document.createElement('div');
  msgEl.className = 'message user';
  msgEl.innerHTML = `
    <div class="message-avatar">👤</div>
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>
  `;
  chatArea.appendChild(msgEl);
}

function renderBotMessageElement(text, sources, msgId) {
  hideWelcome();
  const id = msgId || 'bot-msg-' + Date.now();
  const msgEl = document.createElement('div');
  msgEl.className = 'message bot';
  msgEl.id = id;

  msgEl.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-bubble" id="${id}-bubble">${formatAnswer(text)}</div>
      <div class="message-actions" id="${id}-actions">
        <button class="msg-action-btn copy-btn" onclick="copyMessageText('${id}-bubble')">📋 Copy</button>
        <button class="msg-action-btn read-aloud-btn" onclick="toggleReadAloud('${id}')">🔊 Listen</button>
      </div>
      <div class="message-sources" id="${id}-sources"></div>
    </div>
  `;
  chatArea.appendChild(msgEl);

  const bubbleEl = $(`#${id}-bubble`);
  renderMath(bubbleEl);

  if (sources && sources.length > 0) {
    const sourcesEl = $(`#${id}-sources`);
    renderSources(sourcesEl, sources);
  }
}

function createBotMessageContainer() {
  const msgEl = document.createElement('div');
  msgEl.className = 'message bot';
  const msgId = 'bot-msg-' + Date.now();
  msgEl.id = msgId;

  msgEl.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-bubble" id="${msgId}-bubble">
        <span class="streaming-cursor"></span>
      </div>
      <div class="message-actions" id="${msgId}-actions" style="display: none;">
        <button class="msg-action-btn copy-btn" onclick="copyMessageText('${msgId}-bubble')">📋 Copy</button>
        <button class="msg-action-btn read-aloud-btn" onclick="toggleReadAloud('${msgId}')">🔊 Listen</button>
      </div>
      <div class="message-sources" id="${msgId}-sources"></div>
    </div>
  `;
  chatArea.appendChild(msgEl);
  scrollToBottom();
  return { msgEl, msgId };
}

async function sendMessage() {
  const question = chatInput.value.trim();
  if (!question) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  state.isLoading = true;

  // Auto-name active thread if first question
  const activeThread = getActiveThread();
  if (activeThread && activeThread.messages.length === 0) {
    activeThread.title = question.slice(0, 28) + (question.length > 28 ? '...' : '');
    saveThreads();
    renderThreads();
  }

  // Add to active thread state
  renderUserMessageElement(question);
  if (activeThread) {
    activeThread.messages.push({ role: 'user', text: question, mode: state.currentMode });
    saveThreads();
  }

  const { msgId } = createBotMessageContainer();
  const bubbleEl = $(`#${msgId}-bubble`);
  const sourcesEl = $(`#${msgId}-sources`);
  const actionsEl = $(`#${msgId}-actions`);

  let fullAnswerText = '';
  let receivedSources = [];

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        mode: state.currentMode,
        session_id: state.sessionId,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Streaming connection failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const block of lines) {
        if (!block.startsWith('data: ')) continue;
        const jsonStr = block.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'metadata') {
            receivedSources = event.sources || [];
            if (event.session_id) {
              state.sessionId = event.session_id;
              localStorage.setItem('rag_active_session_id', state.sessionId);
            }
          } else if (event.type === 'token') {
            fullAnswerText += event.text;
            bubbleEl.innerHTML = formatAnswer(fullAnswerText) + '<span class="streaming-cursor"></span>';
            renderMath(bubbleEl);
            scrollToBottom();
          } else if (event.type === 'done') {
            fullAnswerText = event.answer || fullAnswerText;
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        } catch (parseErr) {
          console.warn('SSE Parse error', parseErr, jsonStr);
        }
      }
    }

    bubbleEl.innerHTML = formatAnswer(fullAnswerText);
    renderMath(bubbleEl);
    actionsEl.style.display = 'flex';

    if (receivedSources.length > 0) {
      renderSources(sourcesEl, receivedSources);
    }

    // Save to thread history
    if (activeThread) {
      activeThread.messages.push({
        id: msgId,
        role: 'bot',
        text: fullAnswerText,
        sources: receivedSources,
        mode: state.currentMode,
      });
      saveThreads();
    }

  } catch (err) {
    bubbleEl.className = 'message-bubble error-bubble';
    bubbleEl.innerHTML = `⚠️ ${escapeHtml(err.message)}`;
    showToast(err.message, 'error');
  }

  state.isLoading = false;
  sendBtn.disabled = !chatInput.value.trim();
  scrollToBottom();
}

// ---------------------------------------------------------------------------
// Source Citations & Passage Modal (NO SIMILARITY SCORE)
// ---------------------------------------------------------------------------
function renderSources(containerEl, sources) {
  if (!sources || sources.length === 0) return;

  const sourceCardsHtml = sources
    .map((s, idx) => {
      const sourceId = `src-${Date.now()}-${idx}`;
      state.sourcesStore.set(sourceId, s);

      return `
        <div class="source-card interactive" onclick="openSourceModal('${sourceId}')" title="Click to view passage and PDF page">
          <span class="source-rank">#${s.rank || idx + 1}</span>
          <span class="source-doc">${escapeHtml(s.doc)}</span>
          <span class="source-page">Page ${s.page}</span>
          <span class="source-view-hint">🔍 View Passage</span>
        </div>
      `;
    })
    .join('');

  containerEl.innerHTML = `
    <button class="sources-toggle expanded" onclick="toggleSources(this)">
      📎 ${sources.length} source${sources.length > 1 ? 's' : ''} cited
      <span class="toggle-arrow">▼</span>
    </button>
    <div class="sources-list visible">
      ${sourceCardsHtml}
    </div>
  `;
}

let activeModalSource = null;

function openSourceModal(sourceId) {
  const source = state.sourcesStore.get(sourceId);
  if (!source) return;

  activeModalSource = source;
  modalSourceRank.textContent = `#${source.rank || 1}`;
  modalDocTitle.textContent = source.doc;
  modalMeta.textContent = `Page ${source.page}`;
  modalPassageText.textContent = source.text || 'No passage text available.';

  sourceModal.style.display = 'flex';
}

function closeSourceModal() {
  sourceModal.style.display = 'none';
  activeModalSource = null;
}

modalCloseBtn.addEventListener('click', closeSourceModal);
modalDoneBtn.addEventListener('click', closeSourceModal);
sourceModal.addEventListener('click', (e) => {
  if (e.target === sourceModal) closeSourceModal();
});

modalCopyBtn.addEventListener('click', () => {
  const text = modalPassageText.textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Passage copied to clipboard!', 'success', 2000);
  });
});

modalViewPdfBtn.addEventListener('click', () => {
  if (activeModalSource) {
    const { doc, page } = activeModalSource;
    closeSourceModal();
    openPdfViewer(doc, page);
  }
});

window.openSourceModal = openSourceModal;

// ---------------------------------------------------------------------------
// In-App PDF Viewer (PDF.js) with Page Jumping & Zoom
// ---------------------------------------------------------------------------
async function openPdfViewer(docName, pageNum = 1) {
  state.currentPdfName = docName;
  state.currentPdfPage = parseInt(pageNum) || 1;
  pdfDocTitle.textContent = docName;
  pdfModal.style.display = 'flex';
  pdfLoading.style.display = 'flex';

  try {
    const url = `/api/documents/${encodeURIComponent(docName)}/file`;
    const loadingTask = pdfjsLib.getDocument(url);
    state.currentPdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.currentPdfDoc.numPages;

    pdfTotalPagesEl.textContent = state.totalPdfPages;
    await renderPdfPage(state.currentPdfPage);
  } catch (err) {
    console.error('PDF load error:', err);
    showToast(`Could not load '${docName}'. Make sure it was uploaded during this session.`, 'error');
    closePdfViewer();
  } finally {
    pdfLoading.style.display = 'none';
  }
}
window.openPdfViewer = openPdfViewer;

async function renderPdfPage(pageNumber) {
  if (!state.currentPdfDoc) return;

  state.currentPdfPage = Math.max(1, Math.min(pageNumber, state.totalPdfPages));
  pdfCurrentPageEl.textContent = state.currentPdfPage;
  pdfPageBadge.textContent = `Pg ${state.currentPdfPage} / ${state.totalPdfPages}`;

  pdfPrevBtn.disabled = state.currentPdfPage <= 1;
  pdfNextBtn.disabled = state.currentPdfPage >= state.totalPdfPages;

  try {
    pdfLoading.style.display = 'flex';
    const page = await state.currentPdfDoc.getPage(state.currentPdfPage);
    const viewport = page.getViewport({ scale: state.pdfScale });

    const canvas = pdfCanvas;
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;
  } catch (err) {
    console.warn('Page render error', err);
  } finally {
    pdfLoading.style.display = 'none';
  }
}

pdfPrevBtn.addEventListener('click', () => {
  if (state.currentPdfPage > 1) {
    renderPdfPage(state.currentPdfPage - 1);
  }
});

pdfNextBtn.addEventListener('click', () => {
  if (state.currentPdfPage < state.totalPdfPages) {
    renderPdfPage(state.currentPdfPage + 1);
  }
});

pdfZoomInBtn.addEventListener('click', () => {
  state.pdfScale = Math.min(state.pdfScale + 0.25, 3.0);
  renderPdfPage(state.currentPdfPage);
});

pdfZoomOutBtn.addEventListener('click', () => {
  state.pdfScale = Math.max(state.pdfScale - 0.25, 0.75);
  renderPdfPage(state.currentPdfPage);
});

function closePdfViewer() {
  pdfModal.style.display = 'none';
  state.currentPdfDoc = null;
}

pdfCloseBtn.addEventListener('click', closePdfViewer);
pdfModal.addEventListener('click', (e) => {
  if (e.target === pdfModal) closePdfViewer();
});

// ---------------------------------------------------------------------------
// Copy Message & Export Chat
// ---------------------------------------------------------------------------
function copyMessageText(elementId) {
  const el = $(`#${elementId}`);
  if (!el) return;
  const text = el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Answer copied to clipboard!', 'success', 2000);
  });
}
window.copyMessageText = copyMessageText;

exportChatBtn.addEventListener('click', () => {
  const thread = getActiveThread();
  if (!thread || !thread.messages || thread.messages.length === 0) {
    showToast('No chat messages to export in this conversation.', 'info');
    return;
  }

  let md = `# RAG Chatbot — ${thread.title}\n\n`;
  md += `**Date**: ${new Date(thread.created || Date.now()).toLocaleString()}\n`;
  md += `**Documents Indexed**: ${state.documents.join(', ') || 'None'}\n\n---\n\n`;

  thread.messages.forEach((msg) => {
    if (msg.role === 'user') {
      md += `### 👤 User (${msg.mode || 'default'} mode)\n${msg.text}\n\n`;
    } else {
      md += `### 🤖 Assistant\n${msg.text}\n\n`;
      if (msg.sources && msg.sources.length > 0) {
        md += `**Sources Cited**:\n`;
        msg.sources.forEach((s) => {
          md += `- **${s.doc}** (Page ${s.page})\n`;
        });
        md += `\n`;
      }
      md += `---\n\n`;
    }
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rag_${thread.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Chat exported as Markdown file! 📥', 'success');
});

// New chat / Clear handler
if (clearBtn) {
  clearBtn.addEventListener('click', startNewChat);
}

// ---------------------------------------------------------------------------
// Formatting Helpers & KaTeX Math Rendering
// ---------------------------------------------------------------------------
function toggleSources(btn) {
  const sourcesList = btn.nextElementSibling;
  btn.classList.toggle('expanded');
  sourcesList.classList.toggle('visible');
}
window.toggleSources = toggleSources;

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function formatAnswer(text) {
  if (!text) return '';

  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      return window.marked.parse(text, { breaks: true, gfm: true });
    } catch (e) {
      console.warn('Marked parse error', e);
    }
  }

  let formatted = escapeHtml(text);
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/`(.+?)`/g, '<code>$1</code>');
  formatted = formatted.replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>');
  formatted = formatted.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  formatted = formatted.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  formatted = formatted.replace(/\n\n/g, '</p><p>');
  formatted = formatted.replace(/\n/g, '<br>');
  formatted = `<p>${formatted}</p>`;
  formatted = formatted.replace(/<p>\s*<\/p>/g, '');
  return formatted;
}

function renderMath(element) {
  if (!element) return;
  if (typeof renderMathInElement === 'function') {
    try {
      renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
    } catch (err) {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  renderThreads();
  loadThreadMessages();

  try {
    const res = await fetch('/api/documents');
    if (res.ok) {
      const data = await res.json();
      state.documents = data.documents || [];
      renderDocuments();
      updateStatus();
    }
  } catch (e) {
    // Server initializing
  }
}

init();
