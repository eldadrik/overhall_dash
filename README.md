# Trend Pulse Dashboard

Next.js dashboard for:

- Top 5 Google search trends in Israel / Hebrew
- Top 5 Google search trends in the United States / English
- Top 5 X trends in Israel / Hebrew through Grok X Search
- Top 5 X trends in the United States / English through Grok X Search
- A Polymarket market selected by the custom Interesting Score

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `XAI_API_KEY`: required for Grok X Search
- `XAI_MODEL`: defaults to `grok-4.20-reasoning`
- `KV_REST_API_URL`: Vercel KV / Redis REST URL
- `KV_REST_API_TOKEN`: Vercel KV / Redis REST token

Local development can fall back to `.cache/grok-x-trends` when KV variables are missing. Vercel production requires the KV variables because serverless files are not persistent.

## Vercel Deployment

1. Create or connect a Vercel KV / Redis store in the Vercel project.
2. Add the environment variables from `.env.example` in Vercel Project Settings.
3. Deploy with the default Vercel Next.js settings:

```bash
npm run build
```

The dashboard page loads a lightweight shell first and fetches `/api/dashboard` client-side. The API route uses Node.js runtime and a 180-second max duration for slow Grok calls.

## Provider Behavior

- Google search trends: public Google Trends RSS.
- X trends: Grok X Search only, cached for one hour in Vercel KV.
- Polymarket: Gamma API plus CLOB price history, ranked by Interesting Score.

## API

The aggregated dashboard JSON is exposed at:

```text
/api/dashboard
```

By default the server caches the aggregated payload in memory for 10 minutes.

You can bypass that dashboard memory cache manually with:

```text
/api/dashboard?refresh=1
```

This does not bypass the one-hour Grok KV cache.
