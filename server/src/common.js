// Small helpers shared by the code server and the shop.

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

// ---------------------------------------------------------------- responses

export function text(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

// Same shape as Google's errors, so the app's error handling reads both. The status
// word (mf_...) is what the app matches on.
export function fail(status, word, message) {
  return json({ error: { code: status, status: word, message } }, status);
}

export const noMinutes = () => fail(402, "mf_no_minutes", "No minutes left on this code");

// ---------------------------------------------------------------- codes

export function normalizeCode(raw) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 10 || !c.startsWith("MF")) return null;
  return `MF-${c.slice(2, 6)}-${c.slice(6)}`;
}

// How long a code stays valid, by the minutes bought: bigger packs last much longer.
// Topping up restarts the clock for every minute on the code. Codes made before expiry
// existed have no date (NULL) and never expire.
export const TRIAL_DAYS = 7;

// Ks a minute: the more minutes, the less each one costs. [from minutes, Ks a minute], biggest first.
// The buy page gets this list from the server, so it is the only place prices are set.
export const TIERS = [[180, 75], [60, 85], [0, 99]];
export const rate = (minutes) => TIERS.find(([from]) => minutes >= from)[1];
export const cost = (minutes) => minutes * rate(minutes);
// The most minutes an amount pays for (5,100 -> 60, 7,500 -> 88).
export const minutesFor = (paid) => Math.max(0, ...TIERS.map(([from, r]) => {
  const m = Math.floor(paid / r);
  return m >= from ? m : 0;
}));
export function validDays(minutes) {
  return minutes >= 180 ? 365 : minutes >= 60 ? 90 : 30;
}
export const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

// SQL for a top-up's new expiry: the later of the current date and ?, and still none for
// a code that never expires.
export const LATER_EXPIRY = "CASE WHEN expires_at IS NULL OR expires_at > ? THEN expires_at ELSE ? END";

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `MF-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
