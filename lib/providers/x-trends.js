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
const MODE_CONFIGS = {
  general: {
    cacheSlug: "general",
    captionLabel: "X trends",
    promptTopic: "the top 5 X trends right now",
    promptGuidance: "Prefer trend-style labels rather than full post text."
  },
  economic: {
    cacheSlug: "economic",
    captionLabel: "economic X trends",
    promptTopic: "the top 5 economic, business, finance, and markets-related X trends right now",
    promptGuidance:
      "Prioritize macroeconomics, markets, companies, policy, rates, inflation, commodities, currencies, jobs, trade, and local business news. Avoid sports or entertainment unless the trend is directly financial."
  }
};

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

function getModeConfig(mode) {
  return MODE_CONFIGS[mode] ?? MODE_CONFIGS.general;
}

function getRequestKey(locale, mode) {
  return `${getModeConfig(mode).cacheSlug}:${locale}`;
}

function getGrokCacheFile(locale, mode) {
  const { cacheSlug } = getModeConfig(mode);
  const fileName = cacheSlug === "general" ? `${locale}.json` : `${cacheSlug}-${locale}.json`;

  return path.join(GROK_CACHE_DIR, fileName);
}

function getGrokCacheKey(locale, mode) {
  const { cacheSlug } = getModeConfig(mode);

  return cacheSlug === "general" ? `grok-x-trends:${locale}` : `grok-x-trends:${cacheSlug}:${locale}`;
}

function getGrokLockKey(locale, mode) {
  const { cacheSlug } = getModeConfig(mode);

  return cacheSlug === "general" ? `grok-x-trends:${locale}:lock` : `grok-x-trends:${cacheSlug}:${locale}:lock`;
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

function buildBucket(locale, mode, items, createdAt) {
  const { countryNameLabel } = getLocaleConfig(locale);
  const { captionLabel } = getModeConfig(mode);

  return {
    provider: "grok-x-search",
    items,
    caption: `Grok via X Search for ${captionLabel} in ${countryNameLabel}. Created at ${createdAt}.`,
    createdAt
  };
}

function isFreshCachePayload(payload, locale, mode) {
  const createdAtMs = Date.parse(payload?.createdAt);
  const cacheAgeMs = Date.now() - createdAtMs;
  const { cacheSlug } = getModeConfig(mode);
  const payloadMode = payload?.mode || "general";

  return (
    payload?.locale === locale &&
    payloadMode === cacheSlug &&
    Array.isArray(payload.items) &&
    payload.items.length > 0 &&
    Number.isFinite(createdAtMs) &&
    cacheAgeMs >= 0 &&
    cacheAgeMs < GROK_CACHE_TTL_MS
  );
}

async function readLocalCachedGrokBucket(locale, mode) {
  try {
    const payload = JSON.parse(await readFile(getGrokCacheFile(locale, mode), "utf8"));

    if (!isFreshCachePayload(payload, locale, mode)) {
      return null;
    }

    return buildBucket(locale, mode, payload.items, payload.createdAt);
  } catch {
    return null;
  }
}

function readMemoryCachedGrokBucket(locale, mode) {
  const payload = memoryGrokCache.get(getRequestKey(locale, mode));

  if (!isFreshCachePayload(payload, locale, mode)) {
    return null;
  }

  return buildBucket(locale, mode, payload.items, payload.createdAt);
}

async function readCachedGrokBucket(locale, mode) {
  if (hasKvConfig()) {
    const payload = await kv.get(getGrokCacheKey(locale, mode));

    if (!isFreshCachePayload(payload, locale, mode)) {
      return null;
    }

    return buildBucket(locale, mode, payload.items, payload.createdAt);
  }

  if (shouldUseLocalCacheFallback()) {
    return readLocalCachedGrokBucket(locale, mode);
  }

  if (shouldUseMemoryCacheFallback()) {
    return readMemoryCachedGrokBucket(locale, mode);
  }

  return null;
}

function buildGrokCachePayload(locale, mode, bucket) {
  const createdAtMs = Date.parse(bucket.createdAt);
  const { cacheSlug } = getModeConfig(mode);

  return {
    version: 1,
    provider: "grok-x-search",
    model: DEFAULTS.xaiModel,
    mode: cacheSlug,
    locale,
    createdAt: bucket.createdAt,
    createdAtUnixMs: createdAtMs,
    expiresAt: new Date(createdAtMs + GROK_CACHE_TTL_MS).toISOString(),
    items: bucket.items
  };
}

async function writeLocalGrokCache(locale, mode, payload) {
  await mkdir(GROK_CACHE_DIR, { recursive: true });

  const cacheFile = getGrokCacheFile(locale, mode);
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempFile, cacheFile);
}

function writeMemoryGrokCache(locale, mode, payload) {
  memoryGrokCache.set(getRequestKey(locale, mode), payload);
}

async function writeGrokCache(locale, mode, bucket) {
  const payload = buildGrokCachePayload(locale, mode, bucket);

  if (hasKvConfig()) {
    await kv.set(getGrokCacheKey(locale, mode), payload, { ex: GROK_CACHE_TTL_SECONDS });
    return;
  }

  if (shouldUseLocalCacheFallback()) {
    await writeLocalGrokCache(locale, mode, payload);
    return;
  }

  if (shouldUseMemoryCacheFallback()) {
    writeMemoryGrokCache(locale, mode, payload);
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

async function generateGrokXTrends(locale, mode) {
  const { countryNamePrompt, languageName } = getLocaleConfig(locale);
  const { promptGuidance, promptTopic } = getModeConfig(mode);

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
        content: `Using X search, identify ${promptTopic} for ${countryNamePrompt}. ${promptGuidance} Keep the results in ${languageName} when possible. For each item return title, a short subtitle, an X search link, and metricValue if a post-count estimate is visible; otherwise null.`
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

  const bucket = buildBucket(locale, mode, normalizeTrendItems(items, locale), new Date().toISOString());
  await writeGrokCache(locale, mode, bucket);

  return bucket;
}

async function getCachedOrGeneratedGrokBucket(locale, { forceRefresh = false, mode = "general" } = {}) {
  const requestKey = getRequestKey(locale, mode);
  const cached = forceRefresh ? null : await readCachedGrokBucket(locale, mode);

  if (cached) {
    return cached;
  }

  if (inFlightGrokRequests.has(requestKey)) {
    return inFlightGrokRequests.get(requestKey);
  }

  let ownsKvLock = false;

  if (hasKvConfig()) {
    const lockAcquired = await kv.set(getGrokLockKey(locale, mode), Date.now(), {
      ex: GROK_LOCK_TTL_SECONDS,
      nx: true
    });

    ownsKvLock = Boolean(lockAcquired);

    if (!ownsKvLock) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const refreshedCache = await readCachedGrokBucket(locale, mode);

        if (refreshedCache) {
          return refreshedCache;
        }
      }
    }
  }

  const request = generateGrokXTrends(locale, mode).finally(async () => {
    inFlightGrokRequests.delete(requestKey);

    if (ownsKvLock) {
      await kv.del(getGrokLockKey(locale, mode)).catch(() => {});
    }
  });

  inFlightGrokRequests.set(requestKey, request);

  return request;
}

export async function getXTrendsBucket(locale, { forceRefresh = false, mode = "general" } = {}) {
  if (hasXaiKey()) {
    return getCachedOrGeneratedGrokBucket(locale, { forceRefresh, mode });
  }

  throw new Error("XAI_API_KEY is not configured for Grok X Search.");
}
