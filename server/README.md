# Myanmar Flow code server

A small Cloudflare Worker that lets people use Myanmar Flow with a **code** (`MF-XXXX-XXXX`)
instead of their own Gemini API key. You sell minutes by hand, make a code on the admin page,
and send it to them. The Worker passes their speech to Gemini with your key and takes the
minutes off their code.

- Only the app's own models are allowed (transcribe, transcribe-live, and the clean-up models).
  The Live connection accepts audio only, so a code can't be used as a general chatbot.
- Speech is charged by its length, rounded to the millisecond. A clean-up or translation
  call costs 5 seconds. A Live recording is charged only if words came back.
- Your Gemini key stays on Cloudflare. It is never sent to the app.

## One-time setup

You need a free Cloudflare account and Node.js. Run these in this `server` folder:

```bash
npm install
npx wrangler login
npx wrangler d1 create myanmar-flow
```

`d1 create` prints a `database_id`. Paste it into `wrangler.toml` in place of
`REPLACE_WITH_ID_FROM_wrangler_d1_create`. Then:

```bash
npm run db:init
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

- `GEMINI_API_KEY` is your paid key.
- `ADMIN_TOKEN` is a long random password that you make up and keep safe. Anyone with it can create minutes.

`deploy` prints the address, for example `https://myanmar-flow.<you>.workers.dev`.

## Point the app at it

The app already points at `https://myanmar-flow.thecrasho.com` (set in `wrangler.toml` as a custom domain). If you move it, set `CODE_SERVER` in `myanmar_flow.py` to the new address, then build and release. For a quick
test without a release, set the `MF_SERVER` environment variable before starting the app.

Once a server is set, a user can paste a code in the setup wizard (in the same box as the key)
or in Settings → "Myanmar Flow Code". The tray menu shows their minutes left, and the app warns
them once when fewer than 10 minutes remain.

## Selling minutes

Open `https://<your address>/admin` and enter the admin token. From there you can:

- **Code အသစ် ထုတ်မယ်**: make a code with some minutes. Copy it and send it to the buyer.
- **+ မိနစ်**: add minutes when they top up. They keep the same code.
- **ပိတ်**: switch a code off (and back on).

Suggested packs (cost is about 45 Ks a minute at $1 = 5,000 Ks):

| Pack | Price | Minutes to give |
|---|---|---|
| 30 min | 4,500 Ks | 30 |
| 100 min | 13,500 Ks | 110 (+10%) |
| 300 min | 40,000 Ks | 360 (+20%) |

## Local testing

Make a `.dev.vars` file (it is gitignored) containing the two secrets:

```
GEMINI_API_KEY=...
ADMIN_TOKEN=...
```

Then run:

```bash
npm run db:init:local
npm run dev
```

## Tests

Two end-to-end tests make real Gemini calls (about 30 seconds of speech each) and need the
admin token, either in `server/.admin-token.txt` or in `MF_ADMIN_TOKEN`. Run them from the repo
root with the app's Python:

```bash
.venv/Scripts/python server/tests/server_test.py
.venv/Scripts/python server/tests/app_test.py
```

- `server_test.py` checks the server itself: admin login, balances, batch, clean-up and Live
  transcription, what each costs, refused models and prompts, and empty or switched-off codes.
- `app_test.py` runs the app's own functions with a code, including the Burmese error messages.

Both use the live server by default. To test a local `npm run dev` instead, pass its address,
for example `http://127.0.0.1:8787`. They make small test codes (named `server_test` and
`app_test`) and switch them off at the end. `speech.wav` is an 8.9-second English sentence.

## Things to know

- Google's Gemini terms are written for your own apps. Reselling access to them is a grey area,
  and Google could suspend the key. Keep your Google Cloud billing alert on.
- Gemini isn't offered in every country. `wrangler.toml` turns on Smart Placement, which runs
  the Worker near Google rather than near the user. Still, test once from Myanmar after deploying.
  "location is not supported" means the call left from the wrong place.
