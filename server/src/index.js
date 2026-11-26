// Myanmar Flow top-up server (Cloudflare Worker).
//
// The app talks to this server with a top-up code instead of a Gemini API key. The
// server checks the code, forwards the request to Google with the owner's key, and
// takes the length of the audio off the code's balance. It mirrors Google's paths
// (/v1beta/interactions, /v1beta/models/*:generateContent, the Live WebSocket), so
// the app only swaps the address and the credential.
//
// Only the models the app uses are allowed, so the key can't be used for anything
// else. What people say is never stored or logged.

import { adminPage } from "./admin.js";
import landingPage from "./landing.html";

const GOOGLE = "https://generativelanguage.googleapis.com";
const LIVE_PATH = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const LIVE_MODELS = ["gemini-3.5-transcribe-live"];
const BATCH_MODELS = ["gemini-3.5-transcribe"];
const TEXT_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const TEXT_CALL_MS = 5000;          // a clean-up or translation costs 5 seconds
const MAX_SESSION_MS = 310_000;     // the app stops recording at 300 s
const GRACE_MS = 30_000;            // let the last sentence finish when minutes run out
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return new Response(landingPage, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
      if (url.pathname === "/health") return text("Myanmar Flow server");
      if (url.pathname === "/admin") return new Response(adminPage, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname.startsWith("/admin/api/")) return await admin(request, env, url);
      if (url.pathname === "/mf/balance") return await balance(request, env);
      if (url.pathname === "/mf/where") return await where(request, env);
      if (url.pathname === LIVE_PATH) return await live(request, env, ctx);
      if (url.pathname === "/v1beta/interactions" && request.method === "POST") return await batch(request, env, ctx);
      const m = url.pathname.match(/^\/v1beta\/models\/([\w.-]+):generateContent$/);
      if (m && request.method === "POST") return await generate(request, env, ctx, m[1]);
      return fail(404, "mf_not_found", "Not found");
    } catch (e) {
      console.error("server error:", e && e.stack ? e.stack : String(e));
      return fail(500, "mf_server_error", "Server error");
    }
  },
};

// ---------------------------------------------------------------- responses

function text(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

// Same shape as Google's errors, so the app's error handling reads both. The status
// word (mf_...) is what the app matches on.
function fail(status, word, message) {
  return json({ error: { code: status, status: word, message } }, status);
}

const noMinutes = () => fail(402, "mf_no_minutes", "No minutes left on this code");

// ---------------------------------------------------------------- codes

export function normalizeCode(raw) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 10 || !c.startsWith("MF")) return null;
  return `MF-${c.slice(2, 6)}-${c.slice(6)}`;
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `MF-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// The code's row, or an error response to return.
async function account(request, env) {
  const auth = request.headers.get("authorization") || "";
  const code = normalizeCode(auth.replace(/^Bearer\s+/i, ""));
  if (!code) return { err: fail(401, "mf_code_invalid", "Invalid code") };
  const row = await env.DB.prepare("SELECT code, balance_ms, disabled FROM codes WHERE code = ?").bind(code).first();
  if (!row) return { err: fail(401, "mf_code_invalid", "Invalid code") };
  if (row.disabled) return { err: fail(403, "mf_code_disabled", "This code is turned off") };
  return { row };
}

async function charge(env, code, ms, kind) {
  ms = Math.max(0, Math.round(ms));
  if (!ms) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE codes SET balance_ms = balance_ms - ?1, used_ms = used_ms + ?1, last_used_at = ?2 WHERE code = ?3")
      .bind(ms, now, code),
    env.DB.prepare("INSERT INTO ledger (code, at, kind, ms) VALUES (?1, ?2, ?3, ?4)").bind(code, now, kind, -ms),
  ]);
}

async function balance(request, env) {
  const { row, err } = await account(request, env);
  if (err) return err;
  return json({ seconds: Math.max(0, Math.floor(row.balance_ms / 1000)) });
}

// ---------------------------------------------------------------- audio length

// Bytes in a base64 string, without decoding all of it.
function base64Bytes(s) {
  s = String(s || "");
  return Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
}

// Length of a base64 WAV in ms, from its header (the same numbers Google bills by),
// or null if it isn't plain PCM WAV.
export function wavDurationMs(b64) {
  const head = Uint8Array.from(atob(String(b64 || "").slice(0, 256)), (c) => c.charCodeAt(0));
  const tag = (i) => String.fromCharCode(...head.slice(i, i + 4));
  if (head.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const view = new DataView(head.buffer);
  let i = 12, fmt = null, dataAt = null;
  while (i + 8 <= head.length) {
    const id = tag(i), size = view.getUint32(i + 4, true);
    if (id === "fmt " && i + 24 <= head.length) {
      fmt = {
        format: view.getUint16(i + 8, true), channels: view.getUint16(i + 10, true),
        rate: view.getUint32(i + 12, true), byteRate: view.getUint32(i + 16, true), bits: view.getUint16(i + 22, true),
      };
    }
    if (id === "data") { dataAt = i + 8; break; }
    i += 8 + size + (size % 2);
  }
  if (!fmt || dataAt === null) return null;
  const { format, channels, rate, byteRate, bits } = fmt;
  // A made-up byte rate would make long audio look short, so it must match the rest.
  if (format !== 1 || bits !== 16 || channels < 1 || channels > 2 || rate < 8000 || rate > 48000) return null;
  if (byteRate !== (rate * channels * bits) / 8) return null;
  return (Math.max(0, base64Bytes(b64) - dataAt) / byteRate) * 1000;
}

// Sample rate from "audio/pcm;rate=16000", or null.
export function pcmRate(mime) {
  const m = String(mime || "").match(/^audio\/pcm(?:;\s*rate=(\d+))?$/i);
  if (!m) return null;
  const rate = m[1] ? Number(m[1]) : 16000;
  return rate >= 8000 && rate <= 48000 ? rate : null;
}

// ---------------------------------------------------------------- Google calls

async function forward(path, body, env) {
  const resp = await fetch(GOOGLE + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  return new Response(resp.body, { status: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/json" } });
}

// Batch speech-to-text (the app's fallback when Live fails).
async function batch(request, env, ctx) {
  const { row, err } = await account(request, env);
  if (err) return err;
  if (row.balance_ms <= 0) return noMinutes();
  if (Number(request.headers.get("content-length") || 0) > MAX_AUDIO_BYTES * 1.4) return fail(413, "mf_too_big", "Audio too long");
  const body = await request.json();
  if (!BATCH_MODELS.includes(body.model)) return fail(400, "mf_model_not_allowed", "Model not allowed");
  const input = Array.isArray(body.input) && body.input.length === 1 ? body.input[0] : null;
  if (!input || input.type !== "audio" || input.mime_type !== "audio/wav") return fail(400, "mf_bad_audio", "Send one WAV file");
  const ms = wavDurationMs(input.data);
  if (ms === null) return fail(400, "mf_bad_audio", "Send 16-bit PCM WAV");
  if (ms > MAX_SESSION_MS) return fail(413, "mf_too_big", "Audio too long");
  const resp = await forward("/v1beta/interactions", body, env);
  if (resp.ok) ctx.waitUntil(charge(env, row.code, ms, "batch"));
  return resp;
}

// Clean-up and English translation: text in, text out.
async function generate(request, env, ctx, model) {
  const { row, err } = await account(request, env);
  if (err) return err;
  if (row.balance_ms <= 0) return noMinutes();
  if (!TEXT_MODELS.includes(model)) return fail(400, "mf_model_not_allowed", "Model not allowed");
  const raw = await request.text();
  if (raw.length > MAX_TEXT_BYTES) return fail(413, "mf_too_big", "Text too long");
  const body = JSON.parse(raw);
  const parts = [...(body.contents || []).flatMap((c) => c.parts || []), ...((body.systemInstruction || {}).parts || [])];
  if (!parts.every((p) => Object.keys(p).every((k) => k === "text"))) return fail(400, "mf_text_only", "Text only");
  delete body.tools; // no search or code tools on the owner's key
  const resp = await forward(`/v1beta/models/${model}:generateContent`, body, env);
  if (resp.ok) ctx.waitUntil(charge(env, row.code, TEXT_CALL_MS, "text"));
  return resp;
}

// A WebSocket message as text. Google sends JSON in binary frames, which arrive as an
// ArrayBuffer, or as a Blob in local dev.
async function asText(data) {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) data = await data.arrayBuffer();
  try {
    return new TextDecoder().decode(ArrayBuffer.isView(data) ? data : new Uint8Array(data));
  } catch {
    return "";
  }
}

// Runs async steps one after another, so relayed messages keep their order.
function queue() {
  let tail = Promise.resolve();
  return (step) => { tail = tail.then(step).catch((e) => console.error("relay:", String(e))); };
}

// Live transcription: relay the WebSocket both ways and count the audio sent.
async function live(request, env, ctx) {
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return fail(426, "mf_websocket", "WebSocket only");
  const { row, err } = await account(request, env);
  if (err) return err;
  if (row.balance_ms <= 0) return noMinutes();

  const up = await fetch(GOOGLE + LIVE_PATH, { headers: { upgrade: "websocket", "x-goog-api-key": env.GEMINI_API_KEY } });
  const upstream = up.webSocket;
  if (!upstream) return fail(502, "mf_upstream", `Google refused the connection (${up.status})`);
  upstream.accept();
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  const limit = Math.min(MAX_SESSION_MS, row.balance_ms + GRACE_MS);
  let audioMs = 0, setup = false, heard = false, closed = false;

  const finish = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    for (const ws of [server, upstream]) {
      try { ws.close(code, reason); } catch { try { ws.close(); } catch { /* already closed */ } }
    }
    // Charge only when Google sent words back; a failed session falls back to batch, which is charged there.
    if (heard) ctx.waitUntil(charge(env, row.code, audioMs, "live"));
  };

  const fromApp = queue(), fromGoogle = queue();

  server.addEventListener("message", (event) => fromApp(async () => {
    if (closed) return;
    let msg;
    try {
      msg = JSON.parse(await asText(event.data));
    } catch {
      return finish(1007, "mf_bad_message");
    }
    if (msg.setup) {
      const model = String(msg.setup.model || "").replace(/^models\//, "");
      if (setup || !LIVE_MODELS.includes(model)) return finish(1008, "mf_model_not_allowed");
      delete msg.setup.tools;
      setup = true;
    } else if (!setup) {
      return finish(1008, "mf_setup_first");
    } else {
      // Audio and push-to-talk markers only: no typed prompts on the owner's key.
      const input = msg.realtimeInput;
      if (!input || Object.keys(msg).length !== 1) return finish(1008, "mf_audio_only");
      for (const key of Object.keys(input)) {
        if (!["audio", "activityStart", "activityEnd", "audioStreamEnd"].includes(key)) return finish(1008, "mf_audio_only");
      }
      if (input.audio) {
        const rate = pcmRate(input.audio.mimeType);
        if (!rate) return finish(1008, "mf_bad_audio");
        audioMs += (base64Bytes(input.audio.data) / (rate * 2)) * 1000;
      }
    }
    try { upstream.send(JSON.stringify(msg)); } catch { return finish(1011, "mf_upstream"); }
    if (audioMs > limit) finish(1000, audioMs > MAX_SESSION_MS ? "mf_too_long" : "mf_no_minutes");
  }));

  upstream.addEventListener("message", (event) => fromGoogle(async () => {
    if (closed) return;
    const message = await asText(event.data);
    heard ||= message.includes("nputTranscription"); // inputTranscription or interimInputTranscription
    try { server.send(message); } catch { finish(1011, "mf_client_gone"); }
  }));

  // Close after the messages already on their way, so the last words still arrive.
  server.addEventListener("close", () => fromApp(() => finish()));
  upstream.addEventListener("close", () => fromGoogle(() => finish()));
  server.addEventListener("error", () => fromApp(() => finish(1011, "mf_error")));
  upstream.addEventListener("error", () => fromGoogle(() => finish(1011, "mf_error")));
  return new Response(null, { status: 101, webSocket: client });
}

// ---------------------------------------------------------------- admin

async function isAdmin(request, env) {
  const token = env.ADMIN_TOKEN || "";
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.length < 16 || given.length !== token.length) return false;
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(given), enc.encode(token));
}

async function admin(request, env, url) {
  if (!(await isAdmin(request, env))) return fail(401, "mf_admin", "Wrong admin token");
  const now = new Date().toISOString();
  const parts = url.pathname.split("/").filter(Boolean); // admin, api, codes, [code], [action]
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (parts[2] !== "codes") return fail(404, "mf_not_found", "Not found");
  if (parts.length === 3 && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT code, note, balance_ms, used_ms, disabled, created_at, last_used_at FROM codes ORDER BY created_at DESC",
    ).all();
    return json({ codes: results });
  }
  if (parts.length === 3 && request.method === "POST") {
    const minutes = Number(body.minutes);
    if (!(minutes >= 0 && minutes <= 100000)) return fail(400, "mf_bad_minutes", "Minutes must be 0-100000");
    const code = newCode();
    const ms = Math.round(minutes * 60000);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO codes (code, note, balance_ms, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(code, String(body.note || "").slice(0, 200), ms, now),
      env.DB.prepare("INSERT INTO ledger (code, at, kind, ms) VALUES (?1, ?2, 'topup', ?3)").bind(code, now, ms),
    ]);
    return json({ code, balance_ms: ms }, 201);
  }

  const code = normalizeCode(decodeURIComponent(parts[3] || ""));
  if (!code) return fail(400, "mf_code_invalid", "Invalid code");
  const exists = await env.DB.prepare("SELECT 1 FROM codes WHERE code = ?").bind(code).first();
  if (!exists) return fail(404, "mf_not_found", "No such code");

  if (parts[4] === "topup" && request.method === "POST") {
    const minutes = Number(body.minutes);
    if (!(minutes > 0 && minutes <= 100000)) return fail(400, "mf_bad_minutes", "Minutes must be 1-100000");
    const ms = Math.round(minutes * 60000);
    await env.DB.batch([
      env.DB.prepare("UPDATE codes SET balance_ms = balance_ms + ?1 WHERE code = ?2").bind(ms, code),
      env.DB.prepare("INSERT INTO ledger (code, at, kind, ms) VALUES (?1, ?2, 'topup', ?3)").bind(code, now, ms),
    ]);
    return json({ ok: true });
  }
  if (parts[4] === "disabled" && request.method === "POST") {
    await env.DB.prepare("UPDATE codes SET disabled = ?1 WHERE code = ?2").bind(body.disabled ? 1 : 0, code).run();
    return json({ ok: true });
  }
  if (parts.length === 4 && request.method === "DELETE") {
    // Gone for good, history included. The app then says the code is wrong.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM ledger WHERE code = ?").bind(code),
      env.DB.prepare("DELETE FROM codes WHERE code = ?").bind(code),
    ]);
    return json({ ok: true });
  }
  if (parts[4] === "ledger" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT at, kind, ms FROM ledger WHERE code = ? ORDER BY id DESC LIMIT 100")
      .bind(code).all();
    return json({ ledger: results });
  }
  return fail(404, "mf_not_found", "Not found");
}


// Where the server runs and whether Google accepts calls from there (a free model-list call).
// Cloudflare's own trace page can't answer this: it reports the visitor's country, not the server's.
async function where(request, env) {
  const trace = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace")).text();
  const google = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
                             { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const body = google.ok ? "" : await google.text();
  return json({
    user_country: request.cf?.country,
    runs_in: (trace.match(/^colo=(.*)$/m) || [])[1],
    google_accepts: google.ok,
    google_error: google.ok ? undefined : (body.includes("location is not supported") ? "location not supported" : google.status),
  });
}
