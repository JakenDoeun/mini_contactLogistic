# Phase 13 log: the app in Khmer

Branch `phase13-khmer` (from `phase12-dual-sim`). Asked by the owner on 2026-10-23 ("start now and give me the km.json
file"); the owner translates `src/locales/km.json` themselves or with an LLM.

## How it works

- **One catalogue per language.** `src/locales/en.json` is the source: one flat key per message. `km.json` has the
  same keys. Until a Khmer entry is translated it holds the English text (or is empty), and the app shows English there.
- **Language switch** in the header and on the sign-in page. Each device keeps its own choice (cookie `cb_lang`); the
  server reads it, so the first paint is already in that language.
- **Code:** `src/lib/i18n.ts` (formatter, pure), `src/lib/messages.ts` (catalogue, `translate`, `clientT`),
  `src/lib/i18n-react.tsx` (`useT`, `t.rich`), `src/lib/i18n-server.ts` (page titles). Helpers that used to return
  English (`validateFile`, `contactLine`, the Settings checks) now return a message key and values; the screen
  translates them.
- **Fonts:** Noto Sans Khmer and the system Khmer fonts come after the Latin font, so digits and codes keep their look.

## Rules for whoever translates km.json

1. Change only the text on the right. Never rename, add or remove keys.
2. Keep every `{placeholder}` exactly as written (`{count}`, `{phone}`, `{file}`...). They may move within the sentence.
   Some, like `{link}` or `{code}`, become a link or a styled code on screen.
3. Plurals look like `{count, plural, one {# parcel} other {# parcels}}`. Khmer needs only the `other` part:
   `{count, plural, other {កញ្ចប់ #}}`. `#` is the number. Keep the braces balanced and put no other `{...}` inside
   a plural.
4. Leave brand and product names in Latin letters: Cellcard, Smart, Metfone, Seatel, Tailscale, SMSGate, Telegram,
   Shopee SHPE. Commands such as `npm run gateway -- set` stay as they are.
5. Some English entries start or end with a space or a ` · ` (pieces joined into a line). Keep those spaces.

Check a translation with `npm test`: it fails when a key is missing, a placeholder differs, or a plural cannot be read.
After code adds new messages, `npm run locales` copies the new keys into km.json (in English, to translate).

## Not translated yet

- **Messages that come from the server**: API error texts, the Tailscale readiness checks in Settings
  (`src/lib/tailscale.ts`), import refusals and rules, SMS results ("Delivered", gateway errors). This is the next step
  of Phase 13; its new keys will come as a separate short list so nothing is translated twice.
- **The SMS sent to customers** is a setting (Settings › Default SMS message), not part of the catalogue. A Khmer SMS
  fits about 70 characters per part instead of 160.
- **Dates and times** stay in the English format (e.g. 23 Oct, 03:04 PM) for now.

## Checks (2026-10-23)

- Unit: 211 pass (new: plurals in both catalogues parse; km.json keys and placeholders match en.json). Integration: 20
  pass. `tsc` clean. `next build` in a scratch clone.
- Browser, built app with a pseudo-Khmer catalogue (every message prefixed with "ក") on every page, the import review,
  the parcel drawer and the Notify panel: no screen text bypasses the catalogue apart from the items listed above and
  the browser's own date on the Dashboard. No sideways scrolling at 390 px. `html lang` follows the switch.
