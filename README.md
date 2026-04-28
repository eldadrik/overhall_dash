# Trend Pulse Dashboard

Next.js dashboard for:

- Top 5 Google search trends in Israel / Hebrew
- Top 5 Google search trends in the United States / English
- Top 5 X trends in Israel / Hebrew
- Top 5 X trends in the United States / English
- The hottest Polymarket market by 24-hour volume

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and fill in what you have:

- `X_BEARER_TOKEN`: enables the official X Trends API
- `XAI_API_KEY`: enables xAI fallback/enrichment when Google public fetches fail or X credentials are missing
- `XAI_MODEL`: defaults to `grok-4.20-reasoning`
- `X_WOEID_HE`: defaults to Israel
- `X_WOEID_EN`: defaults to United States

## Provider behavior

- Google search trends: tries the public Google Trends Node client first, then falls back to xAI web search if configured
- X trends: tries the official X Trends by WOEID endpoint first, then falls back to xAI X search if configured
- Polymarket: uses the public Gamma API and selects the active market with the highest `volume24hr`

## API

The aggregated dashboard JSON is exposed at:

```text
/api/dashboard
```

By default the server caches the payload for 10 minutes.

You can bypass that cache manually with:

```text
/api/dashboard?refresh=1
```
