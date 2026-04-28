const globalCache = globalThis.__trendPulseCache ?? new Map();

if (!globalThis.__trendPulseCache) {
  globalThis.__trendPulseCache = globalCache;
}

export async function withTtlCache(key, ttlMs, loader, { forceRefresh = false } = {}) {
  const now = Date.now();
  const existing = globalCache.get(key);

  if (!forceRefresh && existing && existing.value && existing.expiresAt > now) {
    return existing.value;
  }

  if (!forceRefresh && existing?.promise) {
    return existing.promise;
  }

  const promise = loader()
    .then((value) => {
      globalCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
      });
      return value;
    })
    .catch((error) => {
      if (existing?.value) {
        globalCache.set(key, existing);
      } else {
        globalCache.delete(key);
      }
      throw error;
    });

  globalCache.set(key, {
    ...existing,
    promise
  });

  return promise.finally(() => {
    const current = globalCache.get(key);
    if (current?.promise === promise) {
      delete current.promise;
      globalCache.set(key, current);
    }
  });
}
