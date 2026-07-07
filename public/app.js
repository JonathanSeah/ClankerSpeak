(() => {
  const state = {
    activeTab: 'upload',
    uploadedFiles: [], // { filename, text, charCount }
  };

  const TAB_ORDER = ['upload', 'paste', 'form', 'chat'];
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- ambient log ticker (signature element) ----------

  const LOG_LINES = [
    '[source-grounding] waiting for input…',
    '[intake:upload] accepts .txt .md .csv .pdf .docx',
    '[intake:ask] casual chat handled by Botpress',
    '[reasoning-backend] Gemini idle — no request in flight',
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

  // ---------- tabs (with sliding transition) ----------

  const tabs = document.querySelectorAll('.tab');
  const panelsViewport = document.querySelector('.panels');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  function switchTab(name) {
    if (name === state.activeTab) return;
    const oldName = state.activeTab;
    const oldPanel = document.getElementById(`panel-${oldName}`);
    const newPanel = document.getElementById(`panel-${name}`);
    const dir = TAB_ORDER.indexOf(name) > TAB_ORDER.indexOf(oldName) ? 1 : -1;

    state.activeTab = name;
    tabs.forEach((t) => {
      const isActive = t.dataset.tab === name;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (name === 'chat') ensureBotpress();

    if (prefersReducedMotion) {
      oldPanel.classList.remove('active');
      newPanel.classList.add('active');
      updateSourceSummary();
      updateGenerateAvailability();
      return;
    }

    slidePanels(oldPanel, newPanel, dir);
  }

  function slidePanels(oldPanel, newPanel, dir) {
    const container = panelsViewport;
    container.style.height = `${container.offsetHeight}px`;
    container.classList.add('sliding');

    [oldPanel, newPanel].forEach((p) => {
      p.classList.add('panel-anim');
      p.style.position = 'absolute';
      p.style.top = '0';
      p.style.left = '0';
      p.style.width = '100%';
    });

    oldPanel.classList.add('active');
    newPanel.classList.add('active');
    newPanel.style.transform = `translateX(${dir * 100}%)`;
    newPanel.style.opacity = '0';

    // force reflow so the starting transform actually applies before we animate
    void newPanel.offsetWidth;

    const endHeight = newPanel.scrollHeight;

    requestAnimationFrame(() => {
      oldPanel.style.transform = `translateX(${-dir * 100}%)`;
      oldPanel.style.opacity = '0';
      newPanel.style.transform = 'translateX(0)';
      newPanel.style.opacity = '1';
      container.style.height = `${endHeight}px`;
    });

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      [oldPanel, newPanel].forEach((p) => {
        p.classList.remove('panel-anim');
        p.style.position = '';
        p.style.top = '';
        p.style.left = '';
        p.style.width = '';
        p.style.transform = '';
        p.style.opacity = '';
      });
      oldPanel.classList.remove('active');
      container.classList.remove('sliding');
      container.style.height = '';
      updateSourceSummary();
      updateGenerateAvailability();
    }

    newPanel.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 500); // safety net in case transitionend doesn't fire
  }

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

  // ---------- chat tab (Botpress webchat) ----------
  // The casual chatbot is entirely owned by Botpress's own cloud — we just
  // mount their widget. No transcript from here ever reaches our /api/generate
  // (Gemini) pipeline; see the hint text in the panel itself.

  let botpressLoadPromise = null;

  function ensureBotpress() {
    if (botpressLoadPromise) return botpressLoadPromise;

    botpressLoadPromise = (async () => {
      const placeholder = document.getElementById('botpressPlaceholder');
      try {
        const res = await fetch('/api/config');
        const config = await res.json();

        if (!config.botpressBotId || !config.botpressClientId) {
          if (placeholder) {
            placeholder.innerHTML =
              'Assistant not configured yet — add BOTPRESS_BOT_ID and BOTPRESS_CLIENT_ID to .env.';
          }
          return;
        }

        await loadScript('https://cdn.botpress.cloud/webchat/v2.3/inject.js');

        window.botpress.on('webchat:ready', () => {
          if (placeholder) placeholder.remove();
        });

        window.botpress.init({
          botId: config.botpressBotId,
          clientId: config.botpressClientId,
          selector: '#botpressWebchat',
          configuration: {
            botName: 'Script Forge Assistant',
            color: '#2DD4BF',
            variant: 'soft',
            themeMode: 'dark',
            fontFamily: 'inter',
            radius: 2,
          },
        });
      } catch (err) {
        if (placeholder) placeholder.textContent = `⚠ Couldn't load the assistant (${err.message}).`;
      }
    })();

    return botpressLoadPromise;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.body.appendChild(s);
    });
  }

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
        return ''; // Botpress chat is intentionally not a script source
      default:
        return '';
    }
  }

  const sourceSummary = document.getElementById('sourceSummary');
  function updateSourceSummary() {
    if (state.activeTab === 'chat') {
      sourceSummary.textContent = 'Chat tab is for quick questions — pick another tab to generate a script.';
      return;
    }
    const text = getSourceText();
    if (!text || !text.trim()) {
      sourceSummary.textContent = 'No source loaded yet.';
      return;
    }
    sourceSummary.textContent = `${text.length.toLocaleString()} characters ready from “${tabDisplayName(state.activeTab)}”.`;
  }

  function tabDisplayName(name) {
    return { upload: 'Upload sources', paste: 'Paste notes', form: 'Guided brief', chat: 'Ask the assistant' }[name];
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
    };
  }

  // ---------- generate (Gemini via Google API key, server-side) ----------

  const generateBtn = document.getElementById('generateBtn');
  const outputBody = document.getElementById('outputBody');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  let lastScript = '';

  function updateGenerateAvailability() {
    const isChat = state.activeTab === 'chat';
    generateBtn.disabled = isChat;
    generateBtn.title = isChat ? 'Switch to Upload, Paste, or Brief to generate a script.' : '';
  }

  generateBtn.addEventListener('click', async () => {
    const sourceText = getSourceText();
    if (!sourceText || !sourceText.trim()) {
      alert('Add some source content first — upload a file, paste notes, or fill the guided brief.');
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
      generateBtn.textContent = 'Generate script';
      updateGenerateAvailability();
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
  updateGenerateAvailability();
})();
