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
