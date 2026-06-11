# West End Card Scanner

A Next.js web app for the West End Workforce team: photograph a business card on your phone and the contact is extracted and pushed straight into the ATS Tracker (TrackerRMS). CSV export (Google Contacts format) remains as a backup path.

## Features

- **Phone-first capture** - "Scan with Camera" opens the rear camera; installable to the home screen (web manifest)
- **QR code aware** - vCard/MeCard QR codes on cards are decoded client-side (jsQR) and trusted over OCR; a complete vCard skips the AI call entirely
- **Data extraction** via **AI Vision** (OpenAI GPT-4o, JSON mode + schema validation) or **OCR** (Tesseract.js + heuristic parser)
- **ATS Tracker push** - creates a Contact (or Candidate) through `/api/tracker-push` with duplicate detection, per-row status, retry, and "push anyway"; auto-push after extraction is on by default
- **Review and fix** - extracted rows are editable in place before pushing
- **Client-side downscaling** - photos are resized to ~1400px JPEG before upload (faster on conference Wi-Fi, cheaper AI calls)
- **CSV export** with formula escaping, excluding failed extractions
- **Team access gate** - one shared access code (`BCX_ACCESS_CODE`), entered once per device, stored as a signed HttpOnly cookie

## Setup

```bash
cp .env.example .env.local   # then fill in the values
npm ci
npm run dev
```

See `.env.example` for the full environment reference. The deployment-critical ones:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | AI Vision extraction (gpt-4o) |
| `TRACKER_API_TOKEN` | ATS Tracker bearer token (exchanged server-side for a JWT) |
| `BCX_ACCESS_CODE` | Team access code - **required on any deployed instance** |
| `BCX_SESSION_SECRET` | Cookie-signing secret (`openssl rand -hex 32`) |

Without `BCX_ACCESS_CODE` the app runs open (local dev convenience). Never deploy it that way: the extract routes spend OpenAI credits and the push route writes into the live ATS.

## Tracker integration notes

- Auth: `POST /api/Auth/ExchangeToken` swaps the bearer token for a ~7-day JWT, cached in memory and refreshed within an hour of expiry.
- Field names were verified against live API responses (2026-06-10). Casing trap: Contacts use `firstName`, Candidates use `firstname`.
- Tracker's search endpoints ignore text filters, so duplicate detection crawls the contact list (10 records/page, bounded) and matches email/phone locally. Responses expose `dedupCoverage: full | partial | skipped` honestly.
- The card photo itself is **not** stored anywhere - the Tracker API (as used here) has no attachment upload; key details land in a note on the created record instead.

## Testing & CI

```bash
npm test         # jest unit tests (schema, Tracker mapping, vCard/QR, OCR parser)
npm run lint
npx tsc --noEmit
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type-check, tests, and build on every push/PR to main.

## Docker

```bash
docker compose up --build   # serves on port 3000, reads .env.local
```
