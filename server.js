require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
});

// ---------- helpers ----------

function extToKind(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.txt', '.md', '.csv', '.log'].includes(ext)) return 'text';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return 'unsupported';
}

async function extractText(file) {
  const kind = extToKind(file.originalname);
  if (kind === 'text') {
    return file.buffer.toString('utf8');
  }
  if (kind === 'pdf') {
    const data = await pdfParse(file.buffer);
    return data.text;
  }
  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  throw new Error(
    `${file.originalname}: unsupported file type. Upload .txt, .md, .csv, .pdf, or .docx.`
  );
}

function buildSystemPrompt(settings) {
  const {
    audience = 'polytechnic students',
    tone = 'confident and clear',
    durationMinutes = 5,
    includeSpeakerNotes = true,
    keyPoints = '',
  } = settings || {};

  return [
    'You are the reasoning backend for a presentation-script generator used by students preparing graded presentations.',
    `Audience for the final talk: ${audience}.`,
    `Requested tone: ${tone}.`,
    `Target spoken length: approximately ${durationMinutes} minutes.`,
    keyPoints ? `The student wants these points emphasized: ${keyPoints}` : '',
    'Write a complete, natural-sounding spoken script broken into clearly labeled sections (Opening, body sections, Closing).',
    'Use plain paragraphs a person can read aloud, not slide bullet points.',
    includeSpeakerNotes
      ? 'After each section, add a short "[Speaker note: ...]" line with pacing or delivery guidance.'
      : 'Do not include speaker notes, only the spoken script.',
    'Ground every claim strictly in the source material provided by the user. Do not invent facts, statistics, or quotes that are not supported by it.',
    'If the source material is thin, say so plainly in the script rather than fabricating detail.',
  ]
    .filter(Boolean)
    .join('\n');
}

// messages: [{ role: 'user' | 'assistant', content: string }]
async function callOpenRouter({ system, messages }) {
  if (!OPENROUTER_API_KEY) {
    const err = new Error(
      'No OPENROUTER_API_KEY set on the server. Copy .env.example to .env and add your OpenRouter key.'
    );
    err.status = 500;
    throw err;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`OpenRouter API error (${response.status}): ${text}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) {
    const err = new Error('OpenRouter returned no choices (it may have blocked the request).');
    err.status = 502;
    throw err;
  }
  return choice.message.content || '';
}

// Single provider: OpenRouter.
async function callLLM(args) {
  return callOpenRouter(args);
}

// ---------- routes ----------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: 'openrouter', hasApiKey: Boolean(OPENROUTER_API_KEY) });
});

// Non-secret client-side identifiers for the Botpress webchat widget
// (the casual chatbot tab). These are public IDs, not API keys — Botpress's
// own cloud handles that conversation end-to-end, so nothing here ever
// touches OPENROUTER_API_KEY or the generation pipeline below.
app.get('/api/config', (req, res) => {
  res.json({
    botpressBotId: process.env.BOTPRESS_BOT_ID || null,
    botpressClientId: process.env.BOTPRESS_CLIENT_ID || null,
  });
});

// Upload one or more source files (the "NotebookLM-style" grounding tab).
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files were attached.' });
    }
    const results = await Promise.all(
      files.map(async (file) => {
        const text = await extractText(file);
        return {
          filename: file.originalname,
          charCount: text.length,
          text,
        };
      })
    );
    res.json({ files: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Generate the final script from whichever tab supplied the source content.
app.post('/api/generate', async (req, res) => {
  try {
    const { sourceText, settings } = req.body;
    if (!sourceText || !sourceText.trim()) {
      return res.status(400).json({ error: 'No source content was provided.' });
    }
    const system = buildSystemPrompt(settings);
    const script = await callLLM({
      system,
      messages: [
        {
          role: 'user',
          content: `Here is the source material to base the script on:\n\n${sourceText}`,
        },
      ],
    });
    res.json({ script });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Script Forge running at http://localhost:${PORT}`);
  console.log('LLM provider: openrouter');
  if (!OPENROUTER_API_KEY) {
    console.log('Warning: OPENROUTER_API_KEY is not set. Generation calls will fail until it is.');
  }
});
