# Campus Branch console

A small web app for a parcel branch: import the morning's arrival scan from the courier system, group parcels by
customer phone, and contact each customer once by SMS through an Android phone on the branch SIM. It runs on one
office computer and is reached by staff laptops and phones over [Tailscale](https://tailscale.com) HTTPS, so nothing is
exposed to the internet.

Pickup, payments and delivery stay in the courier's own system; this app only finds who to contact and contacts them.

## Status

Work in progress, built in gated phases.

| Part | State |
|---|---|
| Pages (Dashboard, Parcels, Scan, Import Arrivals, Notifications, Settings) | Done; parcel, import and SMS data are still sample data |
| SQLite database, migrations, start-up self-test | Done |
| Staff login, first-run code, recovery code | Done |
| Local backups, data retention, start at boot (Windows and Linux) | Branch `phase3-backups`, being tested |
| Real imports, folder watcher, SMS gateway and queue | Not built yet |

## Requirements

- Node.js 24.21.0 (see `.node-version`)
- Tailscale on the office computer and on every staff device, with MagicDNS and HTTPS certificates enabled in your tailnet
- Linux or Windows

## Run it for development

```sh
npm ci
npm run dev                 # migrates the database, then http://127.0.0.1:3000
npm run first-run-code      # prints the one-time code for creating the first account
```

The database lives outside the project, in `~/.local/share/campus-branch` (or the folder in `DATA_DIR`).

Tests: `npm test` and `npm run test:integration`.

## Serve it on your tailnet

Build in a clean clone (`npm ci && npm run build`), start it on `127.0.0.1:3000`, then run `tailscale serve --bg 3000`
once. Staff open `https://<computer>.<your-tailnet>.ts.net`. Details: `docs/deploy-tailscale.md`.

## Documentation

| Topic | File |
|---|---|
| Tailscale HTTPS setup | `docs/deploy-tailscale.md` |
| Courier export format and import rules | `docs/import-rules.md` |
| Database schema | `docs/phase1-schema.md` |
| Login and accounts | `docs/phase2-login.md` |
| SMS gateway checks (SMSGate on Android) | `docs/smsgate-verification.md` |

## License

MIT, see `LICENSE`.
