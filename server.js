require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || 'gemini-flash-latest';
const API_KEY = process.env.GOOGLE_API_KEY;

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
async function callGemini({ system, messages }) {
  if (!API_KEY) {
    const err = new Error(
      'No GOOGLE_API_KEY set on the server. Copy .env.example to .env and add your Google AI Studio key.'
    );
    err.status = 500;
    throw err;
  }

  // Gemini uses role "model" instead of "assistant".
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 2000 },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`Gemini API error (${response.status}): ${text}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) {
    const err = new Error('Gemini returned no candidates (it may have blocked the request).');
    err.status = 502;
    throw err;
  }
  return candidate.content.parts.map((p) => p.text || '').join('\n');
}

// ---------- routes ----------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(API_KEY) });
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

// One turn of the conversational intake tab.
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array.' });
    }
    const system = [
      'You are a friendly intake assistant chatting with a student before a script is written.',
      'Ask short, specific follow-up questions to pin down: the topic, the key points to cover,',
      'the audience, the tone, and how long the talk should run.',
      'Keep each reply to 2-3 sentences. Once you have enough detail, tell the student they can',
      'click "Use this conversation" to generate the script.',
    ].join(' ');
    const reply = await callGemini({ system, messages });
    res.json({ reply });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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
    const script = await callGemini({
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
  if (!API_KEY) {
    console.log('Warning: GOOGLE_API_KEY is not set. Generation calls will fail until it is.');
  }
});
