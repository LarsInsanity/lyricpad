# LyricPad Next v0.7 — Render / Web Edition

This build restores the strong rhyme behavior of the desktop prototype while keeping the hosted cross-platform architecture.

## What changed in v0.7

- **CodeMirror 6 editor**: one real editor surface, so caret/selection and colored rhyme endings cannot drift apart like the old overlay experiments.
- **Colored end-rhymes inside the editor**: matching rhyme families get A/B/C... colors.
- **Full phonetic rhyme data in the browser**: ~23k common English words generated from CMU pronunciation data and ranked with a common-word corpus.
- **Much better family detection**: examples such as `hello / ago` and `pear / spear` are recognized phonetically rather than by spelling.
- **Better perfect + slant rhyme search** with stressed-vowel matching and common-word ranking.
- **Pronunciation-based syllable counts** when a word is in the dictionary, with a spelling fallback for unknown words.
- Keeps multi-song tabs, local autosave, manual Auto/A/B/C/New/None rhyme control, OpenAI/Ollama support, PWA behavior, Render access-key protection, and import/export.

## Deploying on Render

Push all files in this folder to your existing GitHub repo. In Render use:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Instance:** Free is fine for personal use.

Environment variables:

```text
OPENAI_API_KEY=...
APP_ACCESS_KEY=your-private-access-key
OPENAI_MODEL=gpt-5-mini
```

The `render.yaml` contains the same build/start configuration if you ever use a Blueprint.

## Local run

Run:

```text
npm install
npm run build
npm start
```

Then open `http://localhost:8787`.

## Important after upgrading from v0.6

Because v0.7 changes the JavaScript bundle and PWA cache, do a hard refresh after Render deploys. If an installed PWA still shows the old editor, close it fully and reopen it; if needed clear the site's cached data once. Your song workspace is stored in localStorage, so exporting a workspace before clearing site data is a good precaution.
