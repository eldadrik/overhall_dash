import { DEFAULTS, getXaiApiKey, hasXaiKey } from "@/lib/env";
import { clampItems, prioritizeLocaleItems } from "@/lib/format";

const GOOGLE_TRENDS_TIMEOUT_MS = 30000;
const STOCK_TREND_CONFIG = {
  he: {
    query: "מניית",
    hl: "iw",
    date: "now 1-d",
    label: "מניות"
  },
  en: {
    query: "stock",
    hl: "en-US",
    date: "now 1-d",
    label: "stocks"
  }
};

function decodeEntities(value = "") {
  let decoded = value;

  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'");
  }

  return decoded.replace(/;apos&/g, "'");
}

function stripCdata(value = "") {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return decodeEntities(stripCdata(match?.[1]?.trim() || ""));
}

function extractItems(xml) {
  return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
}

function buildExploreLink(query, geo, date) {
  const params = new URLSearchParams({
    q: query,
    geo
  });

  if (date) {
    params.set("date", date);
  }

  return `https://trends.google.com/trends/explore?${params.toString()}`;
}

function parseGoogleJson(text) {
  return JSON.parse(text.replace(/^\)\]\}'[,]?\s*/, ""));
}

function getGoogleLink(link, fallbackQuery, geo, date) {
  if (!link) {
    return buildExploreLink(fallbackQuery, geo, date);
  }

  if (link.startsWith("http")) {
    return link;
  }

  return `https://trends.google.com${link}`;
}

function getFormattedRelatedValue(keyword) {
  if (typeof keyword.formattedValue === "string") {
    return keyword.formattedValue;
  }

  if (Array.isArray(keyword.formattedValue)) {
    return keyword.formattedValue[0] || null;
  }

  if (Number.isFinite(Number(keyword.value))) {
    return String(keyword.value);
  }

  return null;
}

function dedupeByTitle(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = item.title.trim().toLocaleLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
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
    signal: AbortSignal.timeout(GOOGLE_TRENDS_TIMEOUT_MS)
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
    items: clampItems(prioritizeLocaleItems(entries.map((entry) => normalizeRssTrend(entry, geo, locale)), locale), 10),
    caption: `פיד RSS ציבורי של Google Trends עבור ${geo}.`
  };
}

async function fetchGoogleApiJson(url, label) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0"
    },
    signal: AbortSignal.timeout(GOOGLE_TRENDS_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}.`);
  }

  return parseGoogleJson(await response.text());
}

async function fetchStockExploreTrends(geo, locale) {
  const config = STOCK_TREND_CONFIG[locale] || STOCK_TREND_CONFIG.en;
  const exploreRequest = {
    comparisonItem: [
      {
        keyword: config.query,
        geo,
        time: config.date
      }
    ],
    category: 0,
    property: ""
  };
  const exploreParams = new URLSearchParams({
    hl: config.hl,
    tz: "-180",
    req: JSON.stringify(exploreRequest)
  });
  const explorePayload = await fetchGoogleApiJson(
    `https://trends.google.com/trends/api/explore?${exploreParams.toString()}`,
    "Google Trends Explore"
  );
  const relatedQueriesWidget = explorePayload.widgets?.find((widget) => widget.id === "RELATED_QUERIES");

  if (!relatedQueriesWidget?.token || !relatedQueriesWidget?.request) {
    throw new Error("Google Trends Explore did not return related stock queries.");
  }

  const relatedParams = new URLSearchParams({
    hl: config.hl,
    tz: "-180",
    req: JSON.stringify(relatedQueriesWidget.request),
    token: relatedQueriesWidget.token
  });
  const relatedPayload = await fetchGoogleApiJson(
    `https://trends.google.com/trends/api/widgetdata/relatedsearches?${relatedParams.toString()}`,
    "Google Trends related stock queries"
  );
  const rankedLists = relatedPayload.default?.rankedList || [];
  const risingKeywords = rankedLists[1]?.rankedKeyword || [];
  const topKeywords = rankedLists[0]?.rankedKeyword || [];
  const items = dedupeByTitle([...topKeywords, ...risingKeywords])
    .map((keyword) => {
      const title = keyword.query?.trim();

      if (!title) {
        return null;
      }

      return {
        id: title,
        title,
        subtitle: `Google Trends related query: ${config.query}`,
        link: getGoogleLink(keyword.link, title, geo, config.date),
        metricValue: getFormattedRelatedValue(keyword),
        locale,
        dir: locale === "he" ? "rtl" : "ltr"
      };
    })
    .filter(Boolean);

  if (!items.length) {
    throw new Error("Google Trends Explore did not return stock-related queries.");
  }

  return {
    provider: "google-trends-stock-explore",
    items: clampItems(prioritizeLocaleItems(items, locale), 10),
    caption: `Google Trends Explore related queries for ${config.query}, ${geo}, last 24 hours.`
  };
}

async function fetchWithGrokFallback(geo, locale) {
  const countryNamePrompt = geo === DEFAULTS.searchGeo.he ? "Israel" : "the United States";
  const countryNameLabel = geo === DEFAULTS.searchGeo.he ? "ישראל" : "ארצות הברית";
  const languageName = locale === "he" ? "Hebrew" : "English";

  const body = {
    model: DEFAULTS.xaiModel,
    input: [
      {
        role: "system",
        content:
          "Return strict JSON only. No markdown, no prose. The JSON shape must be {\"items\":[{\"title\":\"\",\"subtitle\":\"\",\"link\":\"\",\"metricValue\":null}]}."
      },
      {
        role: "user",
        content: `Find the top 10 current Google search trends for ${countryNamePrompt}. Prefer titles visible on Google Trends or Google Trends-adjacent reporting. Keep items in ${languageName} where possible. For each item return title, a short subtitle, a Google Trends or Google Search link, and metricValue if a search-volume string is visible; otherwise null.`
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
      Authorization: `Bearer ${getXaiApiKey()}`,
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
        })), locale), 10
    ),
    caption: `פולבק חיפוש רשת של xAI עבור ${countryNameLabel}.`
  };
}

export async function getGoogleTrendsBucket(locale, { mode = "regular" } = {}) {
  const geo = DEFAULTS.searchGeo[locale];

  if (mode === "stocks") {
    return fetchStockExploreTrends(geo, locale);
  }

  try {
    return await fetchPublicRssTrends(geo, locale);
  } catch (error) {
    if (!hasXaiKey()) {
      throw error;
    }

    const fallback = await fetchWithGrokFallback(geo, locale);
    fallback.warning = `מגמות החיפוש עבור ${geo} נטענו דרך פולבק של xAI אחרי שכשל המקור הציבורי של Google.`;
    return fallback;
  }
}
