# AAS Studio · API Playground

A small, shareable web console for the **[AAS Studio](https://aas-studio.vercel.app) public API**.
Drag-drop a datasheet, find a product by name, validate / fix / export — and see
every request, response, and **validation result** rendered explicitly. It
exercises the same `/v1` integration contract a real client tool would call, so
it doubles as living, copy-pasteable API documentation.

> Not the AAS Studio app — a thin client against its public API. MIT licensed.

## What it covers

| Step | Endpoint | What you do |
|---|---|---|
| Model health | `GET /v1/providers` | which LLMs are usable right now — **ok / out of credits / rate-limited / invalid key**, with the active arbiter highlighted |
| Extract | `POST /v1/extract` | drag-drop a PDF → draft AAS + a **compliance verdict**, plus the **ensemble** state ("N of M models voted") and how split fields were arbitrated |
| Find by name | `POST /v1/search-datasheets` | ranked datasheet URLs for a product name |
| Validate | `POST /v1/validate` | paste AAS XML → XSD 3.1 + AASd-* gate, errors as explicit cards |
| Fix | `POST /v1/fix` | deterministic XML repair |
| Export | `POST /v1/export` | submodels JSON → AAS 3.1 XML or `.aasx` download |

Validation errors are parsed into severity-coloured cards (constraint badge like
`AASd-119`, human message, model path / XSD line), grouped and filterable — never
a raw JSON dump.

## How it works (no CORS)

The browser calls **this app's** `/api/proxy/<endpoint>`. A tiny server proxy
([`app/api/proxy/[...path]/route.ts`](app/api/proxy/%5B...path%5D/route.ts))
attaches your Bearer key and forwards to the real API. So the key never crosses
origins and there's no CORS to configure.

## Run it

```bash
npm install
npm run dev
# http://localhost:3000
```

Run the two commands on separate lines (Windows PowerShell 5.1 doesn't accept `&&`).

Open the app, paste your AAS Studio API key (stored in your browser only), and go.

Point at a different backend (e.g. local dev) with an env var. Defaults to
`https://aas-studio.vercel.app/api/v1`.

```bash
# macOS / Linux
AAS_API_BASE=http://localhost:3002/api/v1 npm run dev
```
```powershell
# Windows PowerShell
$env:AAS_API_BASE="http://localhost:3002/api/v1"; npm run dev
```

## Get an API key

From your AAS Studio account (see the app's API/partner docs). The key is a
Bearer token; this console stores it in `localStorage` and sends it only to its
own proxy.

## Deploy

Any Next.js host (Vercel one-click works). Set `AAS_API_BASE` if you don't want
the production default.
