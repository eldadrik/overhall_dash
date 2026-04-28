import { DEFAULTS, hasXBearerToken, hasXaiKey } from "@/lib/env";
import { clampItems, prioritizeLocaleItems } from "@/lib/format";

function buildTrendLink(name) {
  return `https://x.com/search?q=${encodeURIComponent(name)}&src=trend_click&f=live`;
}

async function fetchOfficialXTrends(locale) {
  const woeid = DEFAULTS.xWoeid[locale];
  const url = new URL(`https://api.x.com/2/trends/by/woeid/${woeid}`);
  url.searchParams.set("max_trends", "5");
  url.searchParams.set("trend.fields", "trend_name,tweet_count");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`בקשת המגמות הרשמית של X נכשלה עם קוד ${response.status}.`);
  }

  const payload = await response.json();
  const items = payload?.data ?? [];

  if (!items.length) {
    throw new Error(`מקור המגמות הרשמי של X לא החזיר נתונים עבור WOEID ${woeid}.`);
  }

  return {
    provider: "x-official-trends",
    items: clampItems(
      prioritizeLocaleItems(items.map((item) => ({
        id: item.trend_name,
        title: item.trend_name,
        subtitle: "פיד המגמות הרשמי של X",
        link: buildTrendLink(item.trend_name),
        metricValue: item.tweet_count ? `${new Intl.NumberFormat("en").format(item.tweet_count)} פוסטים` : null,
        locale,
        dir: locale === "he" ? "rtl" : "ltr"
      })), locale)
    ),
    caption: `API המגמות הרשמי של X עבור WOEID ${woeid}.`
  };
}

async function fetchXaiFallback(locale) {
  const countryNamePrompt = locale === "he" ? "Israel" : "the United States";
  const countryNameLabel = locale === "he" ? "ישראל" : "ארצות הברית";
  const languageName = locale === "he" ? "Hebrew" : "English";

  const body = {
    model: process.env.XAI_MODEL || "grok-4.20-reasoning",
    input: [
      {
        role: "system",
        content:
          "Return strict JSON only. No markdown, no prose. The JSON shape must be {\"items\":[{\"title\":\"\",\"subtitle\":\"\",\"link\":\"\",\"metricValue\":null}]}."
      },
      {
        role: "user",
        content: `Using X search, identify the top 5 X trends right now for ${countryNamePrompt}. Prefer trend-style labels rather than full post text. Keep the results in ${languageName} when possible. For each item return title, a short subtitle, an X search link, and metricValue if a post-count estimate is visible; otherwise null.`
      }
    ],
    tools: [
      {
        type: "x_search"
      }
    ]
  };

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`פולבק xAI עם X Search נכשל עם קוד ${response.status}.`);
  }

  const payload = await response.json();
  const text =
    payload.output_text ||
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ||
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "text")?.text ||
    "";
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  if (!items.length) {
    throw new Error("פולבק xAI עם X Search לא החזיר פריטי מגמה.");
  }

  return {
    provider: "xai-x-search-fallback",
    items: clampItems(
      prioritizeLocaleItems(items.map((item) => ({
        id: item.title,
        title: item.title,
        subtitle: item.subtitle || "פולבק xAI דרך X Search",
        link: item.link || buildTrendLink(item.title),
        metricValue: item.metricValue || null,
        locale,
        dir: locale === "he" ? "rtl" : "ltr"
      })), locale)
    ),
    caption: `פולבק xAI דרך X Search עבור ${countryNameLabel}.`,
    warning: `מגמות X עבור ${countryNameLabel} נטענו דרך xAI במקום דרך ה־API הרשמי של X.`
  };
}

export async function getXTrendsBucket(locale) {
  if (hasXBearerToken()) {
    try {
      return await fetchOfficialXTrends(locale);
    } catch (error) {
      if (!hasXaiKey()) {
        throw error;
      }
    }
  }

  if (hasXaiKey()) {
    return fetchXaiFallback(locale);
  }

  throw new Error("לא הוגדרו פרטי גישה למקור הנתונים של X.");
}
