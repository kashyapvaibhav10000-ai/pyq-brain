# PYQ Brain

Personal exam-prep app for B.Pharm Sem 5 (PCI syllabus). Upload previous-year question papers → AI OCR, splits and tags each question (subject / unit / topic / marks) → groups repeated questions → priority table of what to study first → answers written only from your own notes, plus a Hinglish "Samjhao" explainer with read-aloud.

Runs entirely on the Cloudflare free tier: one Worker (Hono JSX SSR + htmx), D1, R2. No front-end build.

## Setup

```sh
npm install
npx wrangler d1 create pyq-brain        # put the printed id into wrangler.jsonc
npx wrangler r2 bucket create pyq-brain-pages
npm run db:migrate:remote
npm run deploy
```

Open the deployed URL → `/setup` sets the passcode (do this right after the first deploy) → `/settings` picks the AI provider (Gemini, any OpenAI-compatible API, or Anthropic) and key.

No secrets live in files or env vars: passcode hash, session secret and AI key are stored in D1 and the key is never sent to the browser.

Local dev: `npm run db:migrate:local && npm run dev`. Tests: `npm test`, `npm run typecheck`.

## Notes (optional)

Answers are built from your own scanned notes. Put your PDFs in `noteskart/<folder>/UNIT-n*.pdf`, then `npm run notes:ocr` (needs poppler + tesseract, `eng.traineddata` in `.tessdata/`) and `npm run notes:import:remote`. Notes, OCR output and generated answers are git-ignored and stay in your own D1.

## Docs

- `CLAUDE.md`: architecture, constraints, conventions
- `DESIGN.md`: the paper-and-pen design system (live specimen at `/design`)

## License

MIT (see `LICENSE`). Font Kevin Sans is MIT (`public/fonts/LICENSE.txt`).
