(() => {
  const state = {
    activeTab: 'upload',
    uploadedFiles: [], // { filename, text, charCount }
    chatMessages: [],  // { role, content }
    chatTranscriptText: '',
  };

  // ---------- ambient log ticker (signature element) ----------

  const LOG_LINES = [
    '[source-grounding] waiting for input…',
    '[intake:upload] accepts .txt .md .csv .pdf .docx',
    '[intake:chat] follow-up questions ready',
    '[reasoning-backend] idle — no request in flight',
    '[settings] audience + tone + duration feed the system prompt',
  ];
  const track = document.getElementById('loglineTrack');
  const doubled = [...LOG_LINES, ...LOG_LINES].join('   //   ');
  track.textContent = doubled;

  // ---------- backend status chip ----------

  const statusChip = document.getElementById('apiStatus');

  function setStatus(online, hasKey) {
    statusChip.classList.toggle('online', online);
    statusChip.classList.toggle('offline', !online);
    let label = 'backend unreachable';
    if (online) label = hasKey ? 'backend ready' : 'backend running — no API key set';
    statusChip.innerHTML = `<span class="dot"></span> ${label}`;
  }

  fetch('/api/health')
    .then((r) => r.json())
    .then((data) => setStatus(true, data.hasApiKey))
    .catch(() => setStatus(false, false));

  // ---------- tabs ----------

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      state.activeTab = name;
      tabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
      updateSourceSummary();
    });
  });

  // ---------- upload tab ----------

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');

  ['dragover', 'dragenter'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length) uploadFiles(files);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  async function uploadFiles(fileListObj) {
    const formData = new FormData();
    Array.from(fileListObj).forEach((f) => formData.append('files', f));

    renderFilePlaceholder();
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      state.uploadedFiles.push(...data.files);
      renderFileList();
      updateSourceSummary();
    } catch (err) {
      renderFileList();
      alert(err.message);
    }
  }

  function renderFilePlaceholder() {
    if (state.uploadedFiles.length === 0) {
      fileList.innerHTML = `<li><span class="fname">reading files…</span></li>`;
    }
  }

  function renderFileList() {
    if (state.uploadedFiles.length === 0) {
      fileList.innerHTML = '';
      return;
    }
    fileList.innerHTML = state.uploadedFiles
      .map(
        (f, i) => `
        <li>
          <span class="fname">${escapeHtml(f.filename)}</span>
          <span class="fmeta">${f.charCount.toLocaleString()} chars</span>
          <button class="fremove" data-idx="${i}" title="Remove">✕</button>
        </li>`
      )
      .join('');
    fileList.querySelectorAll('.fremove').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.uploadedFiles.splice(Number(btn.dataset.idx), 1);
        renderFileList();
        updateSourceSummary();
      });
    });
  }

  // ---------- paste tab ----------

  const pasteArea = document.getElementById('pasteArea');
  const pasteCount = document.getElementById('pasteCount');
  pasteArea.addEventListener('input', () => {
    pasteCount.textContent = `${pasteArea.value.length.toLocaleString()} characters`;
    updateSourceSummary();
  });

  // ---------- form tab ----------

  const formTopic = document.getElementById('formTopic');
  const formPoints = document.getElementById('formPoints');
  const formContext = document.getElementById('formContext');
  [formTopic, formPoints, formContext].forEach((el) =>
    el.addEventListener('input', updateSourceSummary)
  );

  // ---------- chat tab ----------

  const chatWindow = document.getElementById('chatWindow');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const useChatBtn = document.getElementById('useChatBtn');

  function appendChatMsg(role, content) {
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.textContent = content;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    appendChatMsg('user', text);
    state.chatMessages.push({ role: 'user', content: text });
    chatSend.disabled = true;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: state.chatMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat request failed.');
      appendChatMsg('assistant', data.reply);
      state.chatMessages.push({ role: 'assistant', content: data.reply });
      useChatBtn.disabled = false;
    } catch (err) {
      appendChatMsg('assistant', `⚠ ${err.message}`);
    } finally {
      chatSend.disabled = false;
    }
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  useChatBtn.addEventListener('click', () => {
    state.chatTranscriptText = state.chatMessages
      .map((m) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`)
      .join('\n');
    updateSourceSummary();
    flashRailNote('Conversation captured — click "Generate script" when ready.');
  });

  // ---------- shared source assembly ----------

  function getSourceText() {
    switch (state.activeTab) {
      case 'upload':
        return state.uploadedFiles.map((f) => `--- ${f.filename} ---\n${f.text}`).join('\n\n');
      case 'paste':
        return pasteArea.value;
      case 'form': {
        const points = formPoints.value
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => `- ${l}`)
          .join('\n');
        return [
          formTopic.value ? `Topic: ${formTopic.value}` : '',
          points ? `Key points:\n${points}` : '',
          formContext.value ? `Context: ${formContext.value}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
      }
      case 'chat':
        return state.chatTranscriptText;
      default:
        return '';
    }
  }

  const sourceSummary = document.getElementById('sourceSummary');
  function updateSourceSummary() {
    const text = getSourceText();
    if (!text || !text.trim()) {
      sourceSummary.textContent = 'No source loaded yet.';
      return;
    }
    sourceSummary.textContent = `${text.length.toLocaleString()} characters ready from “${tabDisplayName(state.activeTab)}”.`;
  }

  function tabDisplayName(name) {
    return { upload: 'Upload sources', paste: 'Paste notes', form: 'Guided brief', chat: 'Talk it through' }[name];
  }

  function flashRailNote(msg) {
    const original = sourceSummary.textContent;
    sourceSummary.textContent = msg;
    setTimeout(updateSourceSummary, 2200);
  }

  // ---------- settings ----------

  const setDuration = document.getElementById('setDuration');
  const durationOut = document.getElementById('durationOut');
  setDuration.addEventListener('input', () => (durationOut.textContent = setDuration.value));

  function getSettings() {
    return {
      audience: document.getElementById('setAudience').value,
      tone: document.getElementById('setTone').value,
      durationMinutes: Number(setDuration.value),
      includeSpeakerNotes: document.getElementById('setSpeakerNotes').checked,
      keyPoints: state.activeTab === 'form' ? '' : undefined,
    };
  }

  // ---------- generate ----------

  const generateBtn = document.getElementById('generateBtn');
  const outputBody = document.getElementById('outputBody');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  let lastScript = '';

  generateBtn.addEventListener('click', async () => {
    const sourceText = getSourceText();
    if (!sourceText || !sourceText.trim()) {
      alert('Add some source content first — upload a file, paste notes, fill the brief, or finalize a conversation.');
      return;
    }
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating…';
    outputBody.innerHTML = `<p class="placeholder">Reasoning over your source material…</p>`;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceText, settings: getSettings() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed.');
      lastScript = data.script;
      renderScript(lastScript);
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
    } catch (err) {
      outputBody.innerHTML = `<p class="placeholder">⚠ ${escapeHtml(err.message)}</p>`;
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate script';
    }
  });

  function renderScript(text) {
    const html = escapeHtml(text).replace(
      /\[Speaker note:([^\]]*)\]/g,
      '<span class="speaker-note">[Speaker note:$1]</span>'
    );
    outputBody.innerHTML = html;
  }

  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(lastScript);
    copyBtn.textContent = 'Copied ✓';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  });

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([lastScript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'presentation-script.txt';
    a.click();
    URL.revokeObjectURL(url);
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  updateSourceSummary();
})();
