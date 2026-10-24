// npm run locales: keeps src/locales/km.json in step with en.json (Phase 13). New keys are added with their English
// text, to be replaced by the Khmer; keys gone from en.json are removed; existing translations are kept. Order follows
// en.json, so the two files read side by side.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'src', 'locales');
const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, string>) : {});
const en = read('en.json');
const km = read('km.json');
const next = Object.fromEntries(Object.keys(en).map((k) => [k, k in km ? km[k] : en[k]]));
const added = Object.keys(en).filter((k) => !(k in km));
const removed = Object.keys(km).filter((k) => !(k in en));
fs.writeFileSync(path.join(dir, 'km.json'), `${JSON.stringify(next, null, 2)}\n`);
console.log(`km.json: ${Object.keys(next).length} keys; ${added.length} added (English, to translate), ${removed.length} removed.`);
