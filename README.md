# LyricPad Next v0.9 — Cloud + Feature Parity

LyricPad Next is a cross-platform songwriting notepad with phonetic rhyme analysis, syllable/rhyme gutters, realtime feedback, rhyme-aware AI suggestions, and optional Firestore cloud sync.

## v0.9 highlights

- **Brainstorm is back** as a visible AI action.
- Realtime local feedback + optional AI coach from v0.8 remain included.
- Google sign-in with Firebase Authentication.
- Firestore song library shared across PC, Samsung/Android, iPad, and other browsers.
- Local-first autosave remains enabled even when cloud sync is configured.
- Debounced cloud writes rather than a Firestore write on every keystroke.
- Realtime cloud updates from another device.
- Offline Firestore cache on supported browsers.
- Cloud library can reopen songs that are no longer open as local tabs.
- Explicit cloud deletion; closing a tab does **not** delete its Firestore copy.
- Basic conflict protection using each song's `updatedAt` value: a genuinely newer cloud edit can refresh an open local song, while a newer local edit is pushed back to Firestore.
- Workspace exports deliberately omit the LyricPad AI access key.

## Existing songwriting features

- CodeMirror lyric editor with native rhyme-end decorations (no overlay/caret drift).
- Large pronunciation/rhyme dataset loaded in the browser.
- Perfect and near/slant rhyme suggestions.
- Syllable counts.
- Automatic A/B/C/D rhyme-family detection.
- Manual rhyme override: Auto, existing family, New, or None.
- AI Next lines, Tighten, More vivid, and Brainstorm.
- Copy / Insert / Replace actions for AI lyric suggestions.
- Multiple song tabs.
- Realtime mechanical feedback and gutter warnings.
- Optional debounced AI stanza review.
- PWA/offline app shell.
- Local workspace import/export.
- Render-compatible Node backend for OpenAI.

---

# Render deployment

Use the same free Render Web Service setup as before.

**Build command**

```bash
npm install
```

`postinstall` runs the frontend bundle automatically.

**Start command**

```bash
npm start
```

The server listens on Render's `PORT` and exposes `/health`.

For OpenAI, configure these Render environment variables:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
APP_ACCESS_KEY=a-long-private-value
```

`APP_ACCESS_KEY` protects your hosted AI endpoint. Enter the same value once in LyricPad → Settings on each device. It is unrelated to Firebase login.

---

# Firebase / Firestore cloud sync setup

You only need to do this once.

## 1. Create a Firebase project

Open the Firebase Console and create/select a project.

Then choose **Project settings → Your apps → Add app → Web** and register LyricPad as a web app.

Firebase gives you a web configuration containing values similar to:

```js
{
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

LyricPad reads these from Render environment variables rather than hard-coding them into the repository.

## 2. Enable Google sign-in

In Firebase Console:

**Authentication → Sign-in method → Google → Enable**

Then under Authentication settings / authorized domains, make sure your Render hostname is allowed, for example:

```text
lyricpad.onrender.com
```

LyricPad uses a Google sign-in popup. This avoids the additional cross-origin redirect setup that modern Safari/Chrome can require for Firebase redirect authentication.

## 3. Create Cloud Firestore

In Firebase Console open **Firestore Database** and create the database.

Then replace the Firestore rules with the included `firestore.rules` file:

```text
firestore.rules
```

Those rules store songs under:

```text
/users/<firebase-user-uid>/songs/<song-id>
```

and only allow the authenticated owner of that UID to read or write them.

Do **not** use `allow read, write: if true` for LyricPad.

## 4. Add Firebase variables to Render

In Render → LyricPad service → Environment, add:

```text
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
```

Save and redeploy.

The Firebase web configuration identifies the Firebase project; authorization of your lyric data comes from Firebase Authentication and Firestore Security Rules.

## 5. Sign in from LyricPad

After redeployment:

1. Open LyricPad.
2. Open **Cloud**.
3. Choose **Sign in with Google**.
4. Choose the Google account you enabled for the project.
5. Your currently open local songs are uploaded automatically.

There is also an **Upload open local songs** button if you want to force an initial upload.

## 6. Use another device

Open the same Render URL on Samsung/iPad/another PC and sign in with the same Google account.

Open the **Cloud** tab to see the shared library and reopen a song locally.

Edits are always saved to the local workspace first, then synced to Firestore after a short pause. Firestore's browser persistence also caches cloud data for offline use on supported browsers.

---

# Storage and sync behavior

LyricPad intentionally has two layers:

1. **Local workspace** — immediate autosave and offline safety.
2. **Firestore cloud library** — cross-device synchronization.

Closing a song tab removes it from the currently open local workspace, but does not delete its Firestore document. Reopen it from **Cloud**.

Use the explicit **Delete** button in Cloud when you really want to remove the cloud copy.

If two devices change the same song around the same time, v0.9 uses the song's modification time to choose which edit is newer. This is appropriate for a personal single-user songwriting app, but it is not Google-Docs-style character-level collaboration.

---

# Firestore rules included

`firestore.rules`:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/songs/{songId} {
      allow read, create, update, delete: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

---

# Local development

Copy `.env.example` to `.env` and fill only the integrations you want.

```bash
npm install
npm start
```

Open:

```text
http://localhost:8787
```

Ollama remains available when LyricPad is running locally. A hosted Render service cannot directly reach Ollama running on your home PC.

## Notes

- v0.9 preserves the existing `lyricpad-next-workspace-v1` local-storage key, so upgrading from recent Next builds should retain the local workspace.
- The service-worker cache name is bumped to v0.9. If a device stubbornly displays an older build, fully close/reopen the installed PWA or hard-refresh the browser.
- Keep workspace JSON exports as an occasional backup even after enabling cloud sync.
