export const CACHE_TTL_MS = 10 * 60 * 1000;

export const DEFAULTS = {
  searchGeo: {
    he: "IL",
    en: "US"
  },
  xWoeid: {
    he: Number(process.env.X_WOEID_HE || 23424852),
    en: Number(process.env.X_WOEID_EN || 23424977)
  },
  xaiModel: process.env.XAI_MODEL || "grok-4.20-reasoning"
};

export function hasXBearerToken() {
  return Boolean(process.env.X_BEARER_TOKEN);
}

export function hasXaiKey() {
  return Boolean(process.env.XAI_API_KEY);
}
