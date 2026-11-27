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

## The public page and the shop

`https://myanmar-flow.thecrasho.com/` is the product page: what the app does, key vs Code
(with the VPN note), prices, how to start, FAQ, and contact. Edit it in `src/landing.html` and
run `npm run deploy`. `/health` answers with plain text for uptime checks.

Codes sell themselves at `/buy` (`src/buy.html`, server side in `src/shop.js`), with nobody at
the till:

1. The buyer picks minutes and gives a name and email (for getting a lost code back). They get
   an exact amount to pay. Amounts are kept unique among unpaid orders (5,940, then 5,941 ...),
   so a payment can only belong to one order.
2. They pay 09 424 469 168 with KBZPay or WavePay and upload the receipt screenshot. Gemini
   reads it: a finished transfer, the right amount and receiver, and a transaction ID that no
   other order used. If something is off, the page says what in Burmese.
3. Your Android phone forwards each wallet notification to the server (MacroDroid, below).
   Gemini reads that too.
4. When the screenshot and a real "money received" notification agree, the order is paid: a
   new code is made (or the buyer's code is topped up) and shown on the page. A screenshot on
   its own never gives minutes, because screenshots can be edited or reused.

A buyer who lost a code gets it back on `/buy` with their email and the transaction ID from
their wallet history (both must match). The app's 💳 menu item opens `/buy` with the user's code
filled in, so a top-up lands in that code. The app's 🎁 button gets a free 5-minute, 7-day trial
code: one per computer, at most 2 per network and 40 in total a day.

**Code validity:** under 60 minutes 30 days, 60 to 179 minutes 90 days, 180 minutes or more one
year, and a free trial 7 days. A top-up moves the date to the later of the current one and the
top-up's own, and revives an expired code with its old minutes. Codes made before expiry
existed (the ones with no date) never expire.

### Phone setup (once)

On the Android phone that receives the KBZPay / WavePay money:

1. Install **MacroDroid** from the Play Store and allow **notification access** when asked.
2. **Add macro → Trigger → Notification → Notification received**. Pick the **KBZPay** and
   **WavePay** apps, with any content.
3. **Action → Connectivity → HTTP request**: method **POST**, URL = the phone link from the admin
   page (Shop → **Copy**). For the body, choose plain text and add the notification's title and
   text from the magic-text (**…**) list.
4. Save the macro. In the phone's settings, set MacroDroid's battery use to **Unrestricted** so
   Android doesn't stop it.
5. Check: the admin page's Shop section shows the time of the last notification it received.

The phone link holds a secret (`PHONE_TOKEN`, set with `npx wrangler secret put PHONE_TOKEN`).
If it ever leaks, put a new one and update the macro. If the phone is off when someone pays,
their order waits; once the phone sends the notification it completes by itself. For anything
stuck, the admin page has a **ငွေရပြီ** button that pays an order by hand.

## Selling minutes by hand

Open `https://<your address>/admin` and enter the admin token. From there you can:

- **Code အသစ် ထုတ်မယ်**: make a code with some minutes. Copy it and send it to the buyer.
- **အခမဲ့ စမ်း ၅ မိနစ်**: make a free 5-minute, 7-day trial code (about 225 Ks of Gemini) for the
  name in the box, for someone without the app's 🎁 button. Its note starts with `trial:`, and the
  page warns you if that name already had one.
- **+ မိနစ်**: add minutes when they top up. They keep the same code.
- **ပိတ်**: switch a code off (and back on).
- **ဖျက်**: delete a code for good, with its minutes and history. It asks first and can't be
  undone; the app then tells that user the code is wrong. Use **ပိတ်** if you might want it back.

Price: a flat **99 Ks a minute**, any amount (Gemini costs about 45 Ks a minute at $1 = 5,000 Ks).
The buyer types the minutes they want in the page's order form, which works out the total. Make the
code with exactly that many minutes. Examples:

| Minutes | Price |
|---|---|
| 30 | 2,970 Ks |
| 60 | 5,940 Ks |
| 180 | 17,820 Ks |

## Backups

The minutes left on codes are money people have already paid, so keep copies. In this folder:

```bash
npm run backup
```

This saves the whole database (codes, minutes, usage history) as
`backups/myanmar-flow-<date>.sql` and keeps the newest 12. The files contain every code, so
`backups/` is gitignored: don't put them anywhere public.

To run it every Sunday at 9 pm on this PC (Windows runs it later if the PC was off), paste this
into PowerShell once:

```powershell
$a = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "run backup" -WorkingDirectory "D:\Second Brain\Projects\Crash Lab\Myanmar flow\server"
$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 9pm
Register-ScheduledTask -TaskName "Myanmar Flow backup" -Action $a -Trigger $t -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
```

To restore a backup (this writes over the live database, so be sure):

```bash
npx wrangler d1 execute myanmar-flow --remote --file backups/<file>.sql
```

Cloudflare also keeps its own restore points for recent days (D1 Time Travel,
`npx wrangler d1 time-travel info myanmar-flow`), which helps after a mistake but isn't a copy
you hold yourself.

## Local testing

Make a `.dev.vars` file (it is gitignored) containing the secrets:

```
GEMINI_API_KEY=...
ADMIN_TOKEN=...
PHONE_TOKEN=...
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
- `shop_test.py` runs the whole shop against a **local** server only (it makes fake receipts and
  phone notifications): unique amounts, every kind of bad screenshot, matching in either order,
  top-ups, lost-code recovery, validity, manual approve and free trials. See its first lines.

Both use the live server by default. To test a local `npm run dev` instead, pass its address,
for example `http://127.0.0.1:8787`. They make small test codes (named `server_test` and
`app_test`) and delete them at the end. `speech.wav` is an 8.9-second English sentence.

## Things to know

- Google's Gemini terms are written for your own apps. Reselling access to them is a grey area,
  and Google could suspend the key. Keep your Google Cloud billing alert on.
- Gemini isn't offered in Myanmar. Cloudflare normally runs a Worker at the location nearest the
  user, which for a Myanmar user can mean Google sees a Myanmar address and refuses. `wrangler.toml`
  pins the Worker to Google Cloud's Singapore region (`targeted` placement) so calls always leave
  from Singapore. To check from any network, open `https://myanmar-flow.thecrasho.com/mf/where`:
  `runs_in` should be `SIN` and `google_accepts` must be `true`. (Confirmed on 2026-11-21 from
  Myanmar with no VPN.)
