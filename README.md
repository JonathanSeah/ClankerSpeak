# ClankSpeak

A small Node/Express console for feeding source material into an AI backend and getting back a spoken presentation script. Built around the four ways a student might have content on hand:

- **Upload sources** — drop in `.txt`, `.md`, `.csv`, `.pdf`, or `.docx` files (report drafts, rubrics, slide notes). Text is extracted server-side.
- **Paste notes** — paste raw text directly.
- **Guided brief** — no document yet? Answer a topic / key points / context form instead.
- **Talk it through** — a short back-and-forth chat that narrows down topic, audience, tone, and length before you finalize it into a script.

A shared **Script settings** panel (audience, tone, target length, speaker notes on/off) applies to whichever tab is active, and feeds the system prompt sent to the model.

## Setup

```bash
cd script-forge
npm install
cp .env.example .env
```

Open `.env` and add your Google AI Studio API key:

```
GOOGLE_API_KEY=AIza...
```

Then run it:

```bash
npm start
```

Visit `http://localhost:3000`.

## How it's wired

- `server.js` — Express server. Serves the static frontend from `public/` and exposes three endpoints:
  - `POST /api/upload` — accepts multipart file uploads, extracts text (via `pdf-parse` for PDFs, `mammoth` for `.docx`), returns extracted text + character counts.
  - `POST /api/chat` — one turn of the intake conversation; forwards the running transcript to the model and returns its reply.
  - `POST /api/generate` — takes assembled source text + settings, builds a system prompt, calls the Gemini API, and returns the finished script.
- `public/index.html` / `styles.css` / `app.js` — the tabbed console UI. Each tab assembles its own `sourceText`; the Generate button always reads from whichever tab is currently active.

## Notes

- No source content ever leaves your machine except in the request sent to Google's API when you click **Generate script** or use the chat tab.
- The model is instructed to ground the script strictly in the material you provide and to flag when material is thin, rather than inventing details.
- Swap `MODEL` in `.env` if you want to point at a different Gemini model (e.g. `gemini-2.5-pro`).
