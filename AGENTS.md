# Repository Guidelines

## Project Structure & Module Organization
Core TypeScript sources live in `src/`: `index.ts` orchestrates CLI flows, `server.ts` serves the correction UI, and `services/` contains FFmpeg, transcription, analysis, and capture helpers. Build artifacts appear in `dist/`, while transcripts, captures, and temp audio reside in `data/`, `output/`, and `temp/` respectively. Keep new modules near related services and wire them into the CLI explicitly so each step remains traceable.

## Build, Test, and Development Commands
- `npm install` — install runtime + type definitions.
- `npm run build` — compile to `dist/` using `tsc`.
- `npm run dev -- <cmd>` — run CLI entrypoints via `ts-node` (e.g., `npm run dev -- analyze --transcript 123`).
- `npm run process -- --video <file>` — end-to-end pipeline: extract, transcribe, persist.
- `npm run server` — start the correction UI at http://localhost:3000.
- `npm start` — execute the compiled CLI in production-like mode.

## Coding Style & Naming Conventions
The project enforces `strict` TypeScript; add explicit types on exports and favor interfaces for shared payloads. Use two-space indentation, camelCase identifiers, PascalCase types, and kebab-case CLI flags or output folders. Avoid reaching into `process.env` inside services—pass typed options derived from `dotenv` instead, and keep services under ~200 lines with focused responsibilities.

## Testing Guidelines
There is no automated suite yet, so validate changes with reproducible CLI runs. Smoke-test by processing a short clip, analyzing it, and running capture to confirm frames still generate. When adding future regression tests, store fixtures under a dedicated `tests/fixtures/` folder and document any manual verification steps in the PR.

## Commit & Pull Request Guidelines
History shows short, imperative commit subjects (e.g., `Add Groq retry logic`). Reference issues when relevant, describe user impact in the body, and mention any new env vars or files. PRs should outline scope, list commands executed (`npm run build`, sample CLI invocations), include UI screenshots for visual tweaks, and checklist any migrations or asset changes.

## Security & Configuration Tips
Keep `.env` local and update `.env.example` whenever new secrets are required (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, optional `OPENAI_API_KEY`). Do not commit raw transcripts or customer captures—scrub `data/` and `output/` before pushing shared reproductions. Install FFmpeg and Playwright from trusted sources and confirm tokens are removed from logs prior to sharing.
