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

function emptyHotBetBucket() {
  return {
    status: "error",
    caption: "נתוני פולימרקט אינם זמינים כרגע.",
    item: null
  };
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

async function loadDashboardData({ refreshGrok = false } = {}) {
  const warnings = [];

  const [searchHe, searchEn, xHe, xEn, hotBet] = await Promise.all([
    settleBucket(() => getGoogleTrendsBucket("he"), () => emptyTrendBucket("מגמות החיפוש בעברית"), warnings, "Google Trends / ישראל"),
    settleBucket(() => getGoogleTrendsBucket("en"), () => emptyTrendBucket("מגמות החיפוש באנגלית"), warnings, "Google Trends / ארה״ב"),
    settleBucket(() => getXTrendsBucket("he", { forceRefresh: refreshGrok }), () => emptyTrendBucket("מגמות X בעברית"), warnings, "X / ישראל"),
    settleBucket(() => getXTrendsBucket("en", { forceRefresh: refreshGrok }), () => emptyTrendBucket("מגמות X באנגלית"), warnings, "X / ארה״ב"),
    settleBucket(() => getHotBetBucket(), emptyHotBetBucket, warnings, "Polymarket")
  ]);

  const activePanels = [searchHe, searchEn, xHe, xEn, hotBet].filter((bucket) => bucket.status !== "error").length;

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
      hotBet: hotBet.provider
    }
  };
}

export async function getDashboardData({ forceRefresh = false, refreshGrok = false } = {}) {
  return withTtlCache("dashboard-v2", CACHE_TTL_MS, () => loadDashboardData({ refreshGrok }), { forceRefresh: forceRefresh || refreshGrok });
}
