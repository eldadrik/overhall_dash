import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { kv } from "@vercel/kv";
import { DEFAULTS, getXaiApiKey, hasXaiKey } from "@/lib/env";
import { clampItems, prioritizeLocaleItems } from "@/lib/format";

const GROK_CACHE_TTL_MS = 60 * 60 * 1000;
const GROK_CACHE_TTL_SECONDS = 60 * 60;
const GROK_LOCK_TTL_SECONDS = 180;
const GROK_CACHE_VERSION = 2;
const GROK_CACHE_DIR = path.join(process.cwd(), ".cache", "grok-x-trends");
const MIN_SOURCE_POST_URLS = 2;
const MAX_SOURCE_POST_URLS_TO_CHECK = 4;
const SOURCE_POST_VERIFY_TIMEOUT_MS = 8000;
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

function getXPostIdFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (!["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.indexOf("status");
    const postId = statusIndex >= 0 ? parts[statusIndex + 1] : null;

    return /^\d+$/.test(postId || "") ? postId : null;
  } catch {
    return null;
  }
}

function normalizeSourcePostUrls(item) {
  const rawUrls = Array.isArray(item.sourcePostUrls) ? item.sourcePostUrls : [];
  const seenPostIds = new Set();

  return rawUrls
    .map((url) => ({
      postId: getXPostIdFromUrl(url),
      url
    }))
    .filter(({ postId }) => postId)
    .filter(({ postId }) => {
      if (seenPostIds.has(postId)) {
        return false;
      }

      seenPostIds.add(postId);
      return true;
    })
    .map(({ postId }) => `https://x.com/i/status/${postId}`);
}

function hasSourceEvidence(item) {
  return normalizeSourcePostUrls(item).length >= MIN_SOURCE_POST_URLS && Boolean(item.evidenceVerifiedAt);
}

async function verifySourcePostUrl(url) {
  const postId = getXPostIdFromUrl(url);
  const oembedUrl = postId ? `https://twitter.com/i/status/${postId}` : url;
  const response = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(oembedUrl)}`, {
    signal: AbortSignal.timeout(SOURCE_POST_VERIFY_TIMEOUT_MS)
  }).catch(() => null);

  return Boolean(response?.ok);
}

async function normalizeTrendItem(item, locale) {
  if (!item?.title) {
    return null;
  }

  const candidatePostUrls = normalizeSourcePostUrls(item).slice(0, MAX_SOURCE_POST_URLS_TO_CHECK);
  const verificationResults = await Promise.all(
    candidatePostUrls.map(async (url) => ({
      url,
      isVerified: await verifySourcePostUrl(url)
    }))
  );
  const sourcePostUrls = verificationResults.filter((result) => result.isVerified).map((result) => result.url);

  if (sourcePostUrls.length < MIN_SOURCE_POST_URLS) {
    return null;
  }

  return {
    id: item.title,
    title: item.title,
    subtitle: item.subtitle || "Verified from X posts",
    link: normalizeTrendLink(item),
    metricValue: item.metricValue || null,
    evidenceSummary: item.evidenceSummary || `Verified from ${sourcePostUrls.length} X posts`,
    sourcePostUrls,
    sourcePostIds: sourcePostUrls.map((url) => getXPostIdFromUrl(url)),
    observedAt: item.observedAt || new Date().toISOString(),
    evidenceVerifiedAt: new Date().toISOString(),
    locale,
    dir: locale === "he" ? "rtl" : "ltr"
  };
}

async function normalizeTrendItems(items, locale) {
  const verifiedItems = (await Promise.all(items.map((item) => normalizeTrendItem(item, locale)))).filter(Boolean);

  return clampItems(
    prioritizeLocaleItems(verifiedItems, locale)
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
    payload.version === GROK_CACHE_VERSION &&
    payload.items.every(hasSourceEvidence) &&
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
    version: GROK_CACHE_VERSION,
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
          "Return strict JSON only. No markdown, no prose. The JSON shape must be {\"items\":[{\"title\":\"\",\"subtitle\":\"\",\"link\":\"\",\"metricValue\":null,\"evidenceSummary\":\"\",\"observedAt\":\"\",\"sourcePostUrls\":[\"\"]}]}."
      },
      {
        role: "user",
        content: `Using X search, identify ${promptTopic} for ${countryNamePrompt}. ${promptGuidance} Keep the results in ${languageName} when possible. For each item return title, a short subtitle, an X search link, metricValue if a post-count estimate is visible otherwise null, evidenceSummary, observedAt, and sourcePostUrls. sourcePostUrls must contain at least ${MIN_SOURCE_POST_URLS} real X post permalinks from X search results that support the trend. Do not use X search URLs as evidence. Omit any item that does not have enough source post URLs.`
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
  const normalizedItems = await normalizeTrendItems(items, locale);

  if (!normalizedItems.length) {
    throw new Error(`Grok X Search did not return source-verified trend items with at least ${MIN_SOURCE_POST_URLS} verified public X post URLs.`);
  }

  const bucket = buildBucket(locale, mode, normalizedItems, new Date().toISOString());
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
