export const CACHE_TTL_MS = 10 * 60 * 1000;

export const DEFAULTS = {
  searchGeo: {
    he: "IL",
    en: "US"
  },
  xaiModel: process.env.XAI_MODEL || "grok-4.20-reasoning"
};

export function getXaiApiKey() {
  const rawValue = process.env.XAI_API_KEY || "";
  const match = rawValue.match(/xai-[A-Za-z0-9_-]+/);

  return match?.[0] || rawValue.trim();
}

export function hasXaiKey() {
  return Boolean(getXaiApiKey());
}
