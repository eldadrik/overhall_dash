import { formatUsd, safeJsonParse } from "@/lib/format";

function buildPolymarketLink(slug) {
  return slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com/";
}

function getProbabilitySummary(market) {
  const outcomes = safeJsonParse(market.outcomes, []);
  const prices = safeJsonParse(market.outcomePrices, []);

  if (!Array.isArray(outcomes) || !Array.isArray(prices) || !outcomes.length || !prices.length) {
    return "אין פירוט הסתברויות";
  }

  const pairs = outcomes.map((outcome, index) => ({
    outcome,
    price: Number(prices[index])
  }));

  const best = pairs
    .filter((pair) => Number.isFinite(pair.price))
    .sort((left, right) => right.price - left.price)[0];

  if (!best) {
    return "אין פירוט הסתברויות";
  }

  return `${best.outcome}: ${Math.round(best.price * 100)}%`;
}

function normalizeMarket(market) {
  return {
    id: market.id,
    title: market.question,
    subtitle: market.description || "Highest 24-hour volume among active markets.",
    link: buildPolymarketLink(market.slug),
    image: market.image || null,
    metricValue: formatUsd(market.volume24hr),
    liquidityValue: formatUsd(market.liquidityClob ?? market.liquidity ?? market.liquidityNum),
    probabilitySummary: getProbabilitySummary(market)
  };
}

export async function getHotBetBucket() {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "25");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`בקשת Polymarket נכשלה עם קוד ${response.status}.`);
  }

  const payload = await response.json();
  const markets = Array.isArray(payload) ? payload : [];

  const market = markets
    .filter((item) => item.active && !item.closed && item.acceptingOrders)
    .sort((left, right) => Number(right.volume24hr || 0) - Number(left.volume24hr || 0))[0];

  if (!market) {
    throw new Error("Polymarket לא החזיר שווקים פעילים.");
  }

  return {
    provider: "polymarket-gamma",
    item: normalizeMarket(market),
    caption: "השוק הפעיל המוביל בפולימרקט לפי נפח ב־24 שעות."
  };
}
