# LyricPad Next v0.6.1 – Render root-route fix

# LyricPad Next v0.5

Cross-platform LyricPad prototype for Windows, Android/Samsung and iPad.

## Main v0.5 change: stable writepad

v0.2-v0.4 tried to color rhyme words inside the browser editor. Different browser text-layout engines could make the caret/highlight rendering look offset. v0.5 removes that entire approach.

The lyric editor is now a **single native `<textarea>`**. There is no duplicate text layer, contenteditable normalization, or character-level highlight overlay. Normal typing, selection, mobile keyboards, paste and cursor positioning are handled directly by the browser.

Rhyme information remains visible in the synchronized gutter:

- line number
- syllable count
- colored rhyme family (A/B/C/...)
- end word beside the rhyme family on desktop

On smaller screens the gutter collapses to the compact family cue to leave more room for lyrics.

## Other features

- Multi-song tabs with autosave/session restore
- BPM, key and song notes per song
- Rhyme family detection
- Auto / A / B / C / New / None continuation override
- Compact offline rhyme list
- OpenAI or Ollama AI provider through the Node server
- Next lines / Tighten / More vivid
- AI suggestion cards with Copy / Insert / Replace line
- Workspace JSON import/export
- Responsive phone/tablet layout
- PWA manifest + offline service worker (requires a secure context outside localhost)

## Run on Windows

Requires Node.js 18+.

1. Extract the folder.
2. Double-click `run_lyricpad_next.bat`.
3. LyricPad opens at `http://localhost:8787`.

No npm install is needed.

## Phone / tablet: easy same-Wi-Fi test

1. Start LyricPad on the PC.
2. Open the **Phone** tab in LyricPad's right-hand tools panel.
3. It shows the PC's detected LAN address, e.g. `http://192.168.1.50:8787`.
4. Keep the PC and phone/tablet on the same Wi-Fi.
5. Open that address on the Samsung/iPad.
6. If Windows Firewall asks about Node.js, allow it on **Private networks**.

This is enough to test and use the responsive UI on your phone while the PC is running.

## Optional local HTTPS / installable PWA

For proper secure-context PWA features on a LAN address:

1. Double-click `setup_phone_https.bat` once.
2. It creates a self-signed LyricPad certificate for `localhost` and the PC's current LAN IPv4 address.
3. It enables HTTPS on port **8788** in `.env`.
4. Restart `run_lyricpad_next.bat`.
5. Open the **Phone** tab. It now shows an `https://...:8788` address and a certificate download link.

Because this is a local self-signed certificate, the phone/tablet must trust it before its browser treats the site as fully secure.

### Samsung / Android

Download/transfer `certs/lyricpad-local.cer` to the phone and install it as a user CA certificate using Android/Samsung Security settings. Menu names differ by Android/One UI version. Then reopen Chrome and use the HTTPS address shown in LyricPad.

### iPad

Open/install the certificate on iPad, then enable full trust for it under **Settings → General → About → Certificate Trust Settings**. Then use the HTTPS address shown in LyricPad in Safari and choose **Add to Home Screen**.

If local certificate setup is annoying, plain HTTP LAN mode remains the easiest development/testing route. A hosted HTTPS deployment is the cleaner long-term solution for anywhere/anytime access.

## OpenAI

The browser never receives your OpenAI API key. Put it in `.env` on the Node server:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6
```

Then select OpenAI in Settings.

## Ollama

Ollama defaults to:

```text
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
```

## Current sync limitation

The song workspace is still stored in each browser/device's local storage. Phone, iPad and PC do **not** automatically share the same song library yet. Cross-device account/sync is the next major infrastructure feature.


## v0.6.1 Render fix

The root route `/` now explicitly serves `public/index.html`. At startup the server logs whether `public/index.html` exists and lists the files found in `public/`. If the frontend is missing from the Git repository, the root page returns a clear diagnostic instead of a generic `Not found`.

Recommended Render settings:

- Build Command: `npm install` (or `yarn`)
- Start Command: `npm start` (or `node server.mjs`)
- Health Check Path: `/health`

Make sure the repository contains the full `public/` folder alongside `server.mjs` and `package.json`.
