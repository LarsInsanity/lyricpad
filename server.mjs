import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8788);
const HTTPS_ENABLED = String(process.env.HTTPS || '').toLowerCase() === '1';
const PFX_PATH = process.env.HTTPS_PFX || path.join(__dirname, 'certs', 'lyricpad-local.pfx');
const PFX_PASS = process.env.HTTPS_PFX_PASS || 'lyricpad';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const APP_ACCESS_KEY = process.env.APP_ACCESS_KEY || '';
const IS_RENDER = String(process.env.RENDER || '').toLowerCase() === 'true';
const INDEX_FILE = path.join(PUBLIC, 'index.html');
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const FIREBASE_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || ''
};
const FIREBASE_ENABLED = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.authDomain && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.appId);


function lanAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries || []) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) out.push(info.address);
    }
  }
  return [...new Set(out)];
}
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 200000) throw new Error('Request too large');
  }
  return body ? JSON.parse(body) : {};
}

function extractOpenAIText(data) {
  const out = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const c of item?.content || []) {
      if (c?.type === 'output_text' && typeof c.text === 'string') out.push(c.text);
    }
  }
  return out.join('\n').trim();
}

async function openAI(prompt, instructions, model) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured on the LyricPad server.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: model || OPENAI_MODEL,
      instructions,
      input: prompt
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  return extractOpenAIText(data);
}

async function ollama(prompt, instructions, model) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || OLLAMA_MODEL,
      prompt: `${instructions}\n\n${prompt}`,
      stream: false,
      options: { temperature: 0.55 }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Ollama request failed (${response.status})`);
  return String(data?.response || '').trim();
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return false;
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(PUBLIC, 'index.html');
  if (!fs.existsSync(target)) return false;
  const ext = path.extname(target).toLowerCase();
  const cache = target.endsWith('service-worker.js') ? 'no-cache' : 'public, max-age=300';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(target).pipe(res);
  return true;
}

const handler = async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    // Serve the app shell explicitly. This avoids platform/path edge cases and
    // makes a missing frontend obvious in deployment logs.
    if (req.method === 'GET' && pathname === '/') {
      if (!fs.existsSync(INDEX_FILE)) {
        console.error(`[frontend] Missing ${INDEX_FILE}`);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(`LyricPad frontend is missing. Expected: ${INDEX_FILE}`);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(INDEX_FILE).pipe(res);
    }

    if (req.method === 'GET' && pathname === '/health') {
      return json(res, 200, { ok: true, service: 'lyricpad-next' });
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      return json(res, 200, { firebase: { enabled: FIREBASE_ENABLED, config: FIREBASE_ENABLED ? FIREBASE_CONFIG : null } });
    }
    if (req.method === 'GET' && pathname === '/api/status') {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
      const host = req.headers.host || `localhost:${PORT}`;
      const publicUrl = `${proto}://${host}`;
      return json(res, 200, {
        ok: true,
        hosted: IS_RENDER || host.endsWith('.onrender.com'),
        publicUrl,
        accessKeyRequired: Boolean(APP_ACCESS_KEY),
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        openaiModel: OPENAI_MODEL,
        firebaseConfigured: FIREBASE_ENABLED,
        ollamaUrl: OLLAMA_URL,
        ollamaModel: OLLAMA_MODEL,
        lanAddresses: lanAddresses(),
        httpUrls: lanAddresses().map(ip => `http://${ip}:${PORT}`),
        httpsUrls: HTTPS_ENABLED ? lanAddresses().map(ip => `https://${ip}:${HTTPS_PORT}`) : [],
        httpsEnabled: HTTPS_ENABLED,
        httpsPort: HTTPS_PORT
      });
    }
    if (req.method === 'GET' && pathname === '/lyricpad-local.cer') {
      const certFile = path.join(__dirname, 'certs', 'lyricpad-local.cer');
      if (!fs.existsSync(certFile)) { res.writeHead(404); return res.end('Local certificate has not been created yet.'); }
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename=lyricpad-local.cer', 'Cache-Control': 'no-store' });
      return fs.createReadStream(certFile).pipe(res);
    }
    if (req.method === 'POST' && pathname === '/api/ai') {
      if (APP_ACCESS_KEY) {
        const supplied = String(req.headers['x-lyricpad-key'] || '');
        if (!supplied || supplied !== APP_ACCESS_KEY) return json(res, 401, { error: 'LyricPad access key is missing or incorrect.' });
      }
      const body = await readJson(req);
      const provider = body.provider === 'ollama' ? 'ollama' : 'openai';
      const prompt = String(body.prompt || '').slice(0, 50000);
      const instructions = String(body.instructions || 'You are a concise songwriting assistant.').slice(0, 12000);
      if (!prompt) return json(res, 400, { error: 'Missing prompt' });
      const text = provider === 'ollama'
        ? await ollama(prompt, instructions, body.model)
        : await openAI(prompt, instructions, body.model);
      return json(res, 200, { text, provider });
    }
    if (req.method === 'GET' && serveStatic(req, res)) return;
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err?.message || String(err) });
  }
};

const server = http.createServer(handler);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[frontend] public dir: ${PUBLIC}`);
  console.log(`[frontend] index.html: ${fs.existsSync(INDEX_FILE) ? 'FOUND' : 'MISSING'}`);
  if (fs.existsSync(PUBLIC)) console.log(`[frontend] files: ${fs.readdirSync(PUBLIC).join(', ')}`);
  console.log(`LyricPad Next running at http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`Phone test: http://${ip}:${PORT}`);
});

if (HTTPS_ENABLED) {
  try {
    const pfx = fs.readFileSync(PFX_PATH);
    const secureServer = https.createServer({ pfx, passphrase: PFX_PASS }, handler);
    secureServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      for (const ip of lanAddresses()) console.log(`Phone HTTPS: https://${ip}:${HTTPS_PORT}`);
    });
  } catch (err) {
    console.error('HTTPS requested but could not start:', err.message);
  }
}
