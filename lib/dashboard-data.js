import { CACHE_TTL_MS } from "@/lib/env";
import { withTtlCache } from "@/lib/cache";
import { getGoogleTrendsBucket } from "@/lib/providers/google-trends";
import { getXTrendsBucket } from "@/lib/providers/x-trends";
import { getHotBetBucket } from "@/lib/providers/polymarket";

function emptyTrendBucket(label) {
  return {
    status: "error",
    caption: `${label} אינם זמינים כרגע.`,
    items: []
  };
}

function loadingTrendBucket(caption = "X trends are loading in a separate request.") {
  return {
    status: "loading",
    caption,
    items: [],
    provider: "loading",
    createdAt: null
  };
}

function emptyHotBetBucket() {
  return {
    status: "error",
    caption: "נתוני פולימרקט אינם זמינים כרגע.",
    item: null
  };
}

function isActiveBucket(bucket) {
  return bucket.status !== "error" && bucket.status !== "loading";
}

async function settleBucket(loader, fallbackFactory, warnings, warningLabel) {
  try {
    const result = await loader();
    if (result.warning) {
      warnings.push(result.warning);
    }
    return {
      status: result.warning ? "warning" : "ok",
      caption: result.caption,
      items: result.items,
      item: result.item,
      provider: result.provider,
      createdAt: result.createdAt
    };
  } catch (error) {
    warnings.push(`${warningLabel}: ${error.message}`);
    return {
      ...fallbackFactory(),
      provider: "unavailable"
    };
  }
}

async function loadXTrendsData({ forceRefresh = false } = {}) {
  const warnings = [];

  const [xHe, xEn, economicXHe, economicXEn] = await Promise.all([
    settleBucket(() => getXTrendsBucket("he", { forceRefresh }), () => emptyTrendBucket("מגמות X בעברית"), warnings, "X / ישראל"),
    settleBucket(() => getXTrendsBucket("en", { forceRefresh }), () => emptyTrendBucket("מגמות X באנגלית"), warnings, "X / ארה״ב"),
    settleBucket(
      () => getXTrendsBucket("he", { forceRefresh, mode: "economic" }),
      () => emptyTrendBucket("Economic X trends / Hebrew"),
      warnings,
      "Economic X / ישראל"
    ),
    settleBucket(
      () => getXTrendsBucket("en", { forceRefresh, mode: "economic" }),
      () => emptyTrendBucket("Economic X trends / English"),
      warnings,
      "Economic X / ארה״ב"
    )
  ]);

  return {
    generatedAt: new Date().toISOString(),
    warnings,
    summary: {
      activePanels: [xHe, xEn, economicXHe, economicXEn].filter(isActiveBucket).length
    },
    xTrends: {
      he: {
        status: xHe.status,
        caption: xHe.caption,
        items: xHe.items,
        createdAt: xHe.createdAt
      },
      en: {
        status: xEn.status,
        caption: xEn.caption,
        items: xEn.items,
        createdAt: xEn.createdAt
      }
    },
    economicXTrends: {
      he: {
        status: economicXHe.status,
        caption: economicXHe.caption,
        items: economicXHe.items,
        createdAt: economicXHe.createdAt
      },
      en: {
        status: economicXEn.status,
        caption: economicXEn.caption,
        items: economicXEn.items,
        createdAt: economicXEn.createdAt
      }
    },
    sources: {
      xTrends: {
        he: xHe.provider,
        en: xEn.provider
      },
      economicXTrends: {
        he: economicXHe.provider,
        en: economicXEn.provider
      }
    }
  };
}

async function loadDashboardData() {
  const warnings = [];

  const [searchHe, searchEn, hotBet] = await Promise.all([
    settleBucket(() => getGoogleTrendsBucket("he"), () => emptyTrendBucket("מגמות החיפוש בעברית"), warnings, "Google Trends / ישראל"),
    settleBucket(() => getGoogleTrendsBucket("en"), () => emptyTrendBucket("מגמות החיפוש באנגלית"), warnings, "Google Trends / ארה״ב"),
    settleBucket(() => getHotBetBucket(), emptyHotBetBucket, warnings, "Polymarket")
  ]);
  const xHe = loadingTrendBucket();
  const xEn = loadingTrendBucket();
  const economicXHe = loadingTrendBucket("Economic X trends are loading in a separate request.");
  const economicXEn = loadingTrendBucket("Economic X trends are loading in a separate request.");

  const activePanels = [searchHe, searchEn, xHe, xEn, economicXHe, economicXEn, hotBet].filter(isActiveBucket).length;

  return {
    generatedAt: new Date().toISOString(),
    warnings,
    summary: {
      activePanels
    },
    searches: {
      he: {
        status: searchHe.status,
        caption: searchHe.caption,
        items: searchHe.items
      },
      en: {
        status: searchEn.status,
        caption: searchEn.caption,
        items: searchEn.items
      }
    },
    xTrends: {
      he: {
        status: xHe.status,
        caption: xHe.caption,
        items: xHe.items,
        createdAt: xHe.createdAt
      },
      en: {
        status: xEn.status,
        caption: xEn.caption,
        items: xEn.items,
        createdAt: xEn.createdAt
      }
    },
    economicXTrends: {
      he: {
        status: economicXHe.status,
        caption: economicXHe.caption,
        items: economicXHe.items,
        createdAt: economicXHe.createdAt
      },
      en: {
        status: economicXEn.status,
        caption: economicXEn.caption,
        items: economicXEn.items,
        createdAt: economicXEn.createdAt
      }
    },
    hotBet: {
      status: hotBet.status,
      caption: hotBet.caption,
      item: hotBet.item
    },
    sources: {
      searches: {
        he: searchHe.provider,
        en: searchEn.provider
      },
      xTrends: {
        he: xHe.provider,
        en: xEn.provider
      },
      economicXTrends: {
        he: economicXHe.provider,
        en: economicXEn.provider
      },
      hotBet: hotBet.provider
    }
  };
}

export async function getXTrendsData({ forceRefresh = false } = {}) {
  return loadXTrendsData({ forceRefresh });
}

export async function getDashboardData({ forceRefresh = false } = {}) {
  return withTtlCache("dashboard-v4", CACHE_TTL_MS, () => loadDashboardData(), { forceRefresh });
}
