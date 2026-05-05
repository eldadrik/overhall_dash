import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { kv } from "@vercel/kv";
import { DEFAULTS, getXaiApiKey, hasXaiKey } from "@/lib/env";
import { clampItems, prioritizeLocaleItems } from "@/lib/format";

const GROK_CACHE_TTL_MS = 60 * 60 * 1000;
const GROK_CACHE_TTL_SECONDS = 60 * 60;
const GROK_LOCK_TTL_SECONDS = 180;
const GROK_CACHE_DIR = path.join(process.cwd(), ".cache", "grok-x-trends");
const inFlightGrokRequests = new Map();
const memoryGrokCache = globalThis.__grokXTrendMemoryCache ?? new Map();

if (!globalThis.__grokXTrendMemoryCache) {
  globalThis.__grokXTrendMemoryCache = memoryGrokCache;
}

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

function getGrokCacheKey(locale) {
  return `grok-x-trends:${locale}`;
}

function getGrokLockKey(locale) {
  return `grok-x-trends:${locale}:lock`;
}

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function shouldUseLocalCacheFallback() {
  return !hasKvConfig() && process.env.VERCEL !== "1";
}

function shouldUseMemoryCacheFallback() {
  return !hasKvConfig() && process.env.VERCEL === "1";
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

async function readLocalCachedGrokBucket(locale) {
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

function readMemoryCachedGrokBucket(locale) {
  const payload = memoryGrokCache.get(locale);

  if (!isFreshCachePayload(payload, locale)) {
    return null;
  }

  return buildBucket(locale, payload.items, payload.createdAt);
}

async function readCachedGrokBucket(locale) {
  if (hasKvConfig()) {
    const payload = await kv.get(getGrokCacheKey(locale));

    if (!isFreshCachePayload(payload, locale)) {
      return null;
    }

    return buildBucket(locale, payload.items, payload.createdAt);
  }

  if (shouldUseLocalCacheFallback()) {
    return readLocalCachedGrokBucket(locale);
  }

  if (shouldUseMemoryCacheFallback()) {
    return readMemoryCachedGrokBucket(locale);
  }

  return null;
}

function buildGrokCachePayload(locale, bucket) {
  const createdAtMs = Date.parse(bucket.createdAt);

  return {
    version: 1,
    provider: "grok-x-search",
    model: DEFAULTS.xaiModel,
    locale,
    createdAt: bucket.createdAt,
    createdAtUnixMs: createdAtMs,
    expiresAt: new Date(createdAtMs + GROK_CACHE_TTL_MS).toISOString(),
    items: bucket.items
  };
}

async function writeLocalGrokCache(locale, payload) {
  await mkdir(GROK_CACHE_DIR, { recursive: true });

  const cacheFile = getGrokCacheFile(locale);
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempFile, cacheFile);
}

function writeMemoryGrokCache(locale, payload) {
  memoryGrokCache.set(locale, payload);
}

async function writeGrokCache(locale, bucket) {
  const payload = buildGrokCachePayload(locale, bucket);

  if (hasKvConfig()) {
    await kv.set(getGrokCacheKey(locale), payload, { ex: GROK_CACHE_TTL_SECONDS });
    return;
  }

  if (shouldUseLocalCacheFallback()) {
    await writeLocalGrokCache(locale, payload);
    return;
  }

  if (shouldUseMemoryCacheFallback()) {
    writeMemoryGrokCache(locale, payload);
  }
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
      Authorization: `Bearer ${getXaiApiKey()}`,
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

async function getCachedOrGeneratedGrokBucket(locale, { forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : await readCachedGrokBucket(locale);

  if (cached) {
    return cached;
  }

  if (inFlightGrokRequests.has(locale)) {
    return inFlightGrokRequests.get(locale);
  }

  let ownsKvLock = false;

  if (hasKvConfig()) {
    const lockAcquired = await kv.set(getGrokLockKey(locale), Date.now(), {
      ex: GROK_LOCK_TTL_SECONDS,
      nx: true
    });

    ownsKvLock = Boolean(lockAcquired);

    if (!ownsKvLock) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const refreshedCache = await readCachedGrokBucket(locale);

        if (refreshedCache) {
          return refreshedCache;
        }
      }
    }
  }

  const request = generateGrokXTrends(locale).finally(async () => {
    inFlightGrokRequests.delete(locale);

    if (ownsKvLock) {
      await kv.del(getGrokLockKey(locale)).catch(() => {});
    }
  });

  inFlightGrokRequests.set(locale, request);

  return request;
}

export async function getXTrendsBucket(locale, { forceRefresh = false } = {}) {
  if (hasXaiKey()) {
    return getCachedOrGeneratedGrokBucket(locale, { forceRefresh });
  }

  throw new Error("XAI_API_KEY is not configured for Grok X Search.");
}
