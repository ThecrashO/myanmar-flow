// Saves the live code database (codes, minutes left, usage history) to backups/ as SQL.
// Run it with `npm run backup` from the server folder. Keeps the newest 12 files.
// The files hold every code, so they are gitignored: keep them off GitHub and anywhere public.
//
// To restore one (this replaces what is on the live server, so be sure):
//   npx wrangler d1 execute myanmar-flow --remote --file backups/<file>.sql
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP = 12;
const server = join(dirname(fileURLToPath(import.meta.url)), "..");
const folder = join(server, "backups");
mkdirSync(folder, { recursive: true });

const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
const name = `myanmar-flow-${stamp}.sql`;
const file = join(folder, name);

// One command string with a quoted relative path, so folders with spaces work on Windows too.
// Cloudflare sometimes refuses an export while another is still running, so try a few times.
const command = `npx wrangler d1 export myanmar-flow --remote --skip-confirmation --output "backups/${name}"`;
for (let attempt = 1; ; attempt++) {
  try { execSync(command, { cwd: server, stdio: "inherit" }); break; }
  catch (e) {
    if (attempt === 3) throw e;
    console.log(`Export failed, trying again in 20 seconds (${attempt}/3)`);
    await new Promise((r) => setTimeout(r, 20000));
  }
}

const size = statSync(file).size;
if (size < 100) throw new Error(`Backup looks empty (${size} bytes): ${file}`);
console.log(`Saved ${file} (${(size / 1024).toFixed(1)} KB)`);

const old = readdirSync(folder).filter((f) => /^myanmar-flow-.*\.sql$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) { rmSync(join(folder, f)); console.log(`Removed old backup ${f}`); }
