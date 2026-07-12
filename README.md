# ClankerSpeak

A small Node/Express console for feeding source material into an AI backend and getting back a spoken presentation script. Built around three ways a student might have content on hand, plus a separate casual chat:

- **Upload sources** — drop in `.txt`, `.md`, `.csv`, `.pdf`, or `.docx` files (report drafts, rubrics, slide notes). Text is extracted server-side.
- **Paste notes** — paste raw text directly.
- **Guided brief** — no document yet? Answer a topic / key points / context form instead.
- **Ask the assistant** — a casual, on-demand chat widget for quick questions or talking through presentation nerves. This one runs entirely on **Botpress** and is intentionally separate from script generation (see "How it's wired" below).

A shared **Script settings** panel (audience, tone, target length, speaker notes on/off) applies to whichever of the first three tabs is active, and feeds the system prompt sent to the model.

## Two AI backends, two jobs

This build follows the project proposal's split of responsibilities:

- **Google AI Studio / Gemini** — the reasoning backend for script writing. It takes whatever source material you assembled (upload/paste/brief) plus your settings, and returns the finished spoken script. This is the only thing your `GOOGLE_API_KEY` is used for.
- **Botpress** — the conversational agent interface for casual, natural back-and-forth. It's embedded as a self-contained webchat widget on the "Ask the assistant" tab and talks directly to Botpress's own cloud; nothing from that conversation is sent to Gemini or used as script source material.

The proposal's third tool, **Synthesia** (AI avatar video of the finished script), is **out of scope for this build** and was deliberately left out — there's no video-generation step here. **NotebookLM**'s source-grounding role is approximated by the Upload sources tab, which extracts and grounds against whatever files you provide.

## Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and add your OpenRouter API key:

```
OPENROUTER_API_KEY=
```

If you want the "Ask the assistant" tab to work, also add your Botpress bot's public IDs (find them under your bot's **Webchat → Share/Embed** settings in Botpress Cloud — these are client-side identifiers, not secrets):

```
BOTPRESS_BOT_ID=...
BOTPRESS_CLIENT_ID=...
```

Then run it:

```bash
npm start
```

Visit `http://localhost:3000`.

## How it's wired

- `server.js` — Express server. Serves the static frontend from `public/` and exposes:
  - `GET /api/health` — whether a `GOOGLE_API_KEY` is set.
  - `GET /api/config` — hands back the (non-secret) `BOTPRESS_BOT_ID` / `BOTPRESS_CLIENT_ID` so the frontend can mount the widget without hardcoding them.
  - `POST /api/upload` — accepts multipart file uploads, extracts text (via `pdf-parse` for PDFs, `mammoth` for `.docx`), returns extracted text + character counts.
  - `POST /api/generate` — takes assembled source text + settings, builds a system prompt, calls the Gemini API, and returns the finished script.
- `public/index.html` / `styles.css` / `app.js` — the tabbed console UI. Each of the first three tabs assembles its own `sourceText`; the Generate button always reads from whichever of those is currently active, and is disabled while the chat tab is open. The chat tab lazy-loads Botpress's own webchat script (`cdn.botpress.cloud`) and mounts it into `#botpressWebchat` the first time you open that tab.

## Look and feel

- A soft white glow drifts slowly behind the whole dark app (the `.aurora` element in `index.html` / `styles.css`) — same composition as a Gemini-style ambient haze, but white instead of blue, over black instead of over white.
- Panels use a frosted-glass look (`backdrop-filter: blur(...)`) over that backdrop, so the glow reads through faintly.
- Switching between tabs slides the outgoing panel out and the incoming panel in, instead of an instant cut; this is skipped automatically for people with `prefers-reduced-motion` set.

## Notes

- No source content ever leaves your machine except in the request sent to Google's API when you click **Generate script**, or messages sent directly to Botpress's cloud from the "Ask the assistant" tab.
- The model is instructed to ground the script strictly in the material you provide and to flag when material is thin, rather than inventing details.
- Swap `MODEL` in `.env` if you want to point at a different Gemini model (e.g. `gemini-2.5-pro`).
