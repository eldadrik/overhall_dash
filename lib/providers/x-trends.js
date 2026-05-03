import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULTS, hasXaiKey } from "@/lib/env";
import { clampItems, prioritizeLocaleItems } from "@/lib/format";

const GROK_CACHE_TTL_MS = 60 * 60 * 1000;
const GROK_CACHE_DIR = path.join(process.cwd(), ".cache", "grok-x-trends");
const inFlightGrokRequests = new Map();

function buildTrendLink(name) {
  return `https://x.com/search?q=${encodeURIComponent(name)}&src=trend_click&f=live`;
}

function getLocaleConfig(locale) {
  return {
    countryNamePrompt: locale === "he" ? "Israel" : "the United States",
    countryNameLabel: locale === "he" ? "Israel" : "United States",
    languageName: locale === "he" ? "Hebrew" : "English"
  };
}

function getGrokCacheFile(locale) {
  return path.join(GROK_CACHE_DIR, `${locale}.json`);
}

function normalizeTrendLink(item) {
  return item.link?.startsWith("https://x.com/search") ? item.link : buildTrendLink(item.title);
}

function normalizeTrendItems(items, locale) {
  return clampItems(
    prioritizeLocaleItems(items.map((item) => ({
      id: item.title,
      title: item.title,
      subtitle: item.subtitle || "Grok via X Search",
      link: normalizeTrendLink(item),
      metricValue: item.metricValue || null,
      locale,
      dir: locale === "he" ? "rtl" : "ltr"
    })), locale)
  );
}

function buildBucket(locale, items, createdAt) {
  const { countryNameLabel } = getLocaleConfig(locale);

  return {
    provider: "grok-x-search",
    items,
    caption: `Grok via X Search for ${countryNameLabel}. Created at ${createdAt}.`,
    createdAt
  };
}

function isFreshCachePayload(payload, locale) {
  const createdAtMs = Date.parse(payload?.createdAt);
  const cacheAgeMs = Date.now() - createdAtMs;

  return (
    payload?.locale === locale &&
    Array.isArray(payload.items) &&
    payload.items.length > 0 &&
    Number.isFinite(createdAtMs) &&
    cacheAgeMs >= 0 &&
    cacheAgeMs < GROK_CACHE_TTL_MS
  );
}

async function readCachedGrokBucket(locale) {
  try {
    const payload = JSON.parse(await readFile(getGrokCacheFile(locale), "utf8"));

    if (!isFreshCachePayload(payload, locale)) {
      return null;
    }

    return buildBucket(locale, payload.items, payload.createdAt);
  } catch {
    return null;
  }
}

async function writeGrokCache(locale, bucket) {
  const createdAtMs = Date.parse(bucket.createdAt);
  const payload = {
    version: 1,
    provider: "grok-x-search",
    model: DEFAULTS.xaiModel,
    locale,
    createdAt: bucket.createdAt,
    createdAtUnixMs: createdAtMs,
    expiresAt: new Date(createdAtMs + GROK_CACHE_TTL_MS).toISOString(),
    items: bucket.items
  };

  await mkdir(GROK_CACHE_DIR, { recursive: true });

  const cacheFile = getGrokCacheFile(locale);
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempFile, cacheFile);
}

function extractOutputText(payload) {
  return (
    payload.output_text ||
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ||
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "text")?.text ||
    ""
  );
}

async function generateGrokXTrends(locale) {
  const { countryNamePrompt, languageName } = getLocaleConfig(locale);

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
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    throw new Error(`Grok X Search failed with status ${response.status}.`);
  }

  const text = extractOutputText(await response.json());
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  if (!items.length) {
    throw new Error("Grok X Search did not return trend items.");
  }

  const bucket = buildBucket(locale, normalizeTrendItems(items, locale), new Date().toISOString());
  await writeGrokCache(locale, bucket);

  return bucket;
}

async function getCachedOrGeneratedGrokBucket(locale) {
  const cached = await readCachedGrokBucket(locale);

  if (cached) {
    return cached;
  }

  if (inFlightGrokRequests.has(locale)) {
    return inFlightGrokRequests.get(locale);
  }

  const request = generateGrokXTrends(locale).finally(() => {
    inFlightGrokRequests.delete(locale);
  });

  inFlightGrokRequests.set(locale, request);

  return request;
}

export async function getXTrendsBucket(locale) {
  if (hasXaiKey()) {
    return getCachedOrGeneratedGrokBucket(locale);
  }

  throw new Error("XAI_API_KEY is not configured for Grok X Search.");
}
