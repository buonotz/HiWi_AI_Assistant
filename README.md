# HiWi AI Assistant

Chrome Side Panel extension for reading job postings, storing a local profile,
and comparing a CV with the current posting.

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

Load `.output/chrome-mv3-dev` as an unpacked extension.

## AI analysis

The OpenAI API key is used only by the local companion server. It is never
included in the browser extension.

1. Copy `.env.example` to `.env.local`.
2. Put your own API key in `.env.local` as `OPENAI_API_KEY`.
3. Start the AI server in a separate terminal:

```powershell
npm.cmd run ai-server
```

4. Upload a CV, open a job posting, and select **Match Analysis → Analyze with
   AI**.

The server sends the CV as a file input and the job page as text to the OpenAI
Responses API. The response must match the strict JSON Schema in
`server/analysis-schema.mjs`, and the extension performs an additional runtime
format check before displaying it.

Never commit `.env.local`; it is excluded by `.gitignore`.

## Verification

```powershell
npm.cmd run check:ai
npm.cmd run compile
npm.cmd run build
```
