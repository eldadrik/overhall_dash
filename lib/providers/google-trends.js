import { DEFAULTS } from "@/lib/env";
import { clampItems, prioritizeLocaleItems } from "@/lib/format";

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return decodeEntities(match?.[1]?.trim() || "");
}

function extractItems(xml) {
  return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
}

function buildExploreLink(query, geo) {
  return `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&geo=${geo}`;
}

function normalizeRssTrend(entry, geo, locale) {
  const title = extractTag(entry, "title") || "טרנד ללא כותרת";
  const approxTraffic = extractTag(entry, "ht:approx_traffic");
  const newsTitle = extractTag(entry, "ht:news_item_title");
  const newsUrl = extractTag(entry, "ht:news_item_url");

  return {
    id: title,
    title,
    subtitle: newsTitle || "פיד ה־RSS הציבורי של Google Trends",
    link: newsUrl || buildExploreLink(title, geo),
    metricValue: approxTraffic || null,
    locale,
    dir: locale === "he" ? "rtl" : "ltr"
  };
}

async function fetchPublicRssTrends(geo, locale) {
  const response = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`בקשת ה־RSS של Google Trends נכשלה עם קוד ${response.status}.`);
  }

  const xml = new TextDecoder("utf-8").decode(await response.arrayBuffer());
  const entries = extractItems(xml);

  if (!entries.length) {
    throw new Error(`פיד ה־RSS של Google Trends לא החזיר תוצאות עבור ${geo}.`);
  }

  return {
    provider: "google-trends-rss",
    items: clampItems(prioritizeLocaleItems(entries.map((entry) => normalizeRssTrend(entry, geo, locale)), locale)),
    caption: `פיד RSS ציבורי של Google Trends עבור ${geo}.`
  };
}

async function fetchWithGrokFallback(geo, locale) {
  const countryNamePrompt = geo === DEFAULTS.searchGeo.he ? "Israel" : "the United States";
  const countryNameLabel = geo === DEFAULTS.searchGeo.he ? "ישראל" : "ארצות הברית";
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
        content: `Find the top 5 current Google search trends for ${countryNamePrompt}. Prefer titles visible on Google Trends or Google Trends-adjacent reporting. Keep items in ${languageName} where possible. For each item return title, a short subtitle, a Google Trends or Google Search link, and metricValue if a search-volume string is visible; otherwise null.`
      }
    ],
    tools: [
      {
        type: "web_search",
        filters: {
          allowed_domains: ["trends.google.com", "support.google.com", "google.com"]
        }
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
    throw new Error(`פולבק של xAI נכשל עם קוד ${response.status}.`);
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
    throw new Error("פולבק xAI לא החזיר פריטי טרנדים של Google.");
  }

  return {
    provider: "xai-web-search-fallback",
    items: clampItems(
      prioritizeLocaleItems(items.map((item) => ({
        id: item.title,
        title: item.title,
        subtitle: item.subtitle || "פולבק מבוסס חיפוש רשת",
        link: item.link || buildExploreLink(item.title, geo),
        metricValue: item.metricValue || null,
        locale,
        dir: locale === "he" ? "rtl" : "ltr"
      })), locale)
    ),
    caption: `פולבק חיפוש רשת של xAI עבור ${countryNameLabel}.`
  };
}

export async function getGoogleTrendsBucket(locale) {
  const geo = DEFAULTS.searchGeo[locale];

  try {
    return await fetchPublicRssTrends(geo, locale);
  } catch (error) {
    if (!process.env.XAI_API_KEY) {
      throw error;
    }

    const fallback = await fetchWithGrokFallback(geo, locale);
    fallback.warning = `מגמות החיפוש עבור ${geo} נטענו דרך פולבק של xAI אחרי שכשל המקור הציבורי של Google.`;
    return fallback;
  }
}
