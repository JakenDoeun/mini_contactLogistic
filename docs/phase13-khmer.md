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
- **Fonts:** Kantumruy Pro for both languages (bundled, `@fontsource-variable/kantumruy-pro`): its Latin and Khmer are
  one family, so mixed lines ("Cellcard 3 កញ្ចប់") read as one font, the same on every phone and PC. The owner picked it
  over Geist, Inter, IBM Plex Sans and Figtree; Kantumruy Pro was chosen over Noto Sans Khmer for the Khmer. Geist Mono
  stays for codes and phone numbers. Khmer is drawn at 95% so it reads the same size as English (see 2026-10-24), Khmer lines are
  taller (1.65) so stacked vowels and subscripts never touch, and letter-spacing is off for Khmer.

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
  fits about 70 characters per part instead of 160. Its placeholders are {name}, {codes}, {count} and {date} (the
  parcels' arrival day as dd-mm-yyyy, added 2026-10-23). Enter starts a new line; the
  line break is kept in the SMS.
- **Dates and times** stay in the English format (e.g. 23 Oct, 03:04 PM) for now.

## Checks (2026-10-23)

- Unit: 211 pass (new: plurals in both catalogues parse; km.json keys and placeholders match en.json). Integration: 20
  pass. `tsc` clean. `next build` in a scratch clone.
- Browser, built app with a pseudo-Khmer catalogue (every message prefixed with "ក") on every page, the import review,
  the parcel drawer and the Notify panel: no screen text bypasses the catalogue apart from the items listed above and
  the browser's own date on the Dashboard. No sideways scrolling at 390 px. `html lang` follows the switch.

## Owner's translation (2026-10-23)

- km.json translated by the owner; `npm test` passes. `placeholders()` now ignores the words inside plural options
  (they are text, not placeholders), so a translated plural no longer fails the check.
- Browser sweep of the built app in real Khmer, desktop and 390 px: no text overflows or is clipped, no sideways
  scrolling, no raw message keys. Fixed on the way: the date filter showed its keys (`range.preset.today`); the branch
  readiness header pushed its button out of the card on a phone; the Dashboard's import numbers sat at uneven heights
  when a Khmer label wrapped; the sign-in illustration spread Khmer letters apart.

## Owner's requests (2026-10-24)

- English uses the same line heights as Khmer, and Khmer letters are drawn at 95% (were 105%, which made a consonant
  28% taller than English lowercase), so switching language no longer looks like zooming in or out.
- The language switch has no box or shadow: UK flag + EN, Cambodian flag + KM (flag-icons 7.5.0, MIT), with a lavender
  pill that slides under the chosen language. Radio buttons named "English" and "Khmer": arrow keys, Home and End
  switch; only the chosen one is a Tab stop. Phones show the flags only, so the page name in the header still fits.
- Page padding on wide screens halved (28 → 14 px sides, 24 → 12 px top), and the content may grow to 1920 px.
- Notification sounds last about 3 seconds: a four-note rising chime, and three rounds of three beeps.
- `{newline}` in an SMS template is a line break, the same as pressing Enter.
- Dashboard: a QR icon button beside Import Arrivals opens a small card (fades and grows in) with a QR code of the
  console's address and the address as text: the Tailscale address, else the page's own address unless it is this
  computer's local one. A tap outside or Escape closes it. The QR drawing is shared with Settings.
