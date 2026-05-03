import { formatUsd, safeJsonParse } from "@/lib/format";

const BOOST_KEYWORDS = [
  "israel",
  "iran",
  "oil",
  "hormuz",
  "trump",
  "fed",
  "cpi",
  "inflation",
  "rates",
  "tariff",
  "china",
  "russia",
  "ukraine",
  "ceasefire",
  "war",
  "election",
  "bitcoin",
  "ethereum"
];

const PENALTY_KEYWORDS = [
  "nba",
  "nfl",
  "mlb",
  "ipl",
  "ufc",
  "soccer",
  "cricket",
  "league",
  "vs",
  "game",
  "goal",
  "points",
  "touchdown",
  "episode",
  "match winner",
  "tweet",
  "tweets",
  "post count",
  "posts from",
  "instagram",
  "tiktok"
];

const PRICE_MOVE_FULL_SCORE = 0.25;
const ATTENTION_FULL_SCORE = 0.2;
const LOW_LIQUIDITY_THRESHOLD = 10000;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function buildPolymarketLink(slug) {
  return slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com/";
}

function parseArray(value) {
  return Array.isArray(value) ? value : safeJsonParse(value, []);
}

function getOutcomes(market) {
  const outcomes = parseArray(market.outcomes);

  return Array.isArray(outcomes) ? outcomes : [];
}

function getOutcomePrices(market) {
  const prices = parseArray(market.outcomePrices);

  if (!Array.isArray(prices)) {
    return [];
  }

  return prices.map((price) => Number(price));
}

function getClobTokenIds(market) {
  const tokenIds = parseArray(market.clobTokenIds);

  return Array.isArray(tokenIds) ? tokenIds : [];
}

function getOutcomePairs(market) {
  const outcomes = getOutcomes(market);
  const prices = getOutcomePrices(market);
  const tokenIds = getClobTokenIds(market);

  return outcomes.map((outcome, index) => ({
    outcome,
    price: Number(prices[index]),
    tokenId: tokenIds[index]
  }));
}

function getPrimaryOutcomePair(market) {
  return getOutcomePairs(market)
    .filter((pair) => Number.isFinite(pair.price) && pair.tokenId)
    .sort((left, right) => right.price - left.price)[0];
}

function hasDisplayableProbability(market) {
  const prices = getOutcomePrices(market).filter((price) => Number.isFinite(price));

  if (!prices.length) {
    return false;
  }

  const roundedProbabilities = prices.map((price) => Math.round(price * 100));

  return roundedProbabilities.every((probability) => probability > 0 && probability < 100);
}

function hasFutureEndDate(market) {
  if (!market.endDate) {
    return true;
  }

  const endDateMs = Date.parse(market.endDate);

  return !Number.isFinite(endDateMs) || endDateMs > Date.now();
}

function getProbabilitySummary(market) {
  const best = getPrimaryOutcomePair(market);

  if (!best) {
    return "No probability data";
  }

  return `${best.outcome}: ${Math.round(best.price * 100)}%`;
}

function getPriceAtOrBefore(history, cutoffSeconds) {
  const points = Array.isArray(history) ? history : [];
  let candidate = null;

  for (const point of points) {
    if (Number(point.t) <= cutoffSeconds && Number.isFinite(Number(point.p))) {
      candidate = Number(point.p);
    }
  }

  return candidate ?? (Number.isFinite(Number(points[0]?.p)) ? Number(points[0].p) : null);
}

function calculatePriceMoveScore(pair, history) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const price24h = getPriceAtOrBefore(history, nowSeconds - 24 * 60 * 60);
  const price7d = getPriceAtOrBefore(history, nowSeconds - 7 * 24 * 60 * 60);
  const moves = [price24h, price7d]
    .filter((price) => Number.isFinite(price))
    .map((price) => Math.abs(pair.price - price));
  const rawMove = moves.length ? Math.max(...moves) : 0;

  return {
    raw: rawMove,
    score: clamp01(rawMove / PRICE_MOVE_FULL_SCORE)
  };
}

function getSearchableText(market) {
  const tagText = Array.isArray(market.tags)
    ? market.tags.map((tag) => [tag.label, tag.slug, tag.name].filter(Boolean).join(" ")).join(" ")
    : "";

  return [
    market.question,
    market.description,
    market.category,
    market.slug,
    tagText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(text, keyword) {
  const escapedKeyword = escapeRegExp(keyword.toLowerCase()).replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(^|[^a-z0-9])${escapedKeyword}([^a-z0-9]|$)`, "i");

  return pattern.test(text);
}

function getTopicScore(text) {
  const matchedBoosts = BOOST_KEYWORDS.filter((keyword) => hasKeyword(text, keyword)).length;

  if (!matchedBoosts) {
    return 0.25;
  }

  return clamp01(0.65 + matchedBoosts * 0.2);
}

function getSportsPenalty(text) {
  return PENALTY_KEYWORDS.some((keyword) => hasKeyword(text, keyword)) ? 1 : 0;
}

function getUrgencyScore(market) {
  if (!market.endDate) {
    return 0.25;
  }

  const endDateMs = Date.parse(market.endDate);

  if (!Number.isFinite(endDateMs) || endDateMs <= Date.now()) {
    return 0;
  }

  const daysUntilEnd = (endDateMs - Date.now()) / (24 * 60 * 60 * 1000);

  return Math.exp(-Math.abs(daysUntilEnd - 10) / 10);
}

function scoreMarket(market, historyByTokenId) {
  const pair = getPrimaryOutcomePair(market);

  if (!pair) {
    return null;
  }

  const text = getSearchableText(market);
  const priceMove = calculatePriceMoveScore(pair, historyByTokenId[pair.tokenId]);
  const volume24h = Number(market.volume24hr || 0);
  const totalVolume = Number(market.volumeNum ?? market.volume ?? 0);
  const liquidity = Number(market.liquidityClob ?? market.liquidity ?? market.liquidityNum ?? 0);
  const uncertaintyScore = 4 * pair.price * (1 - pair.price);
  const attentionShockRaw = volume24h / Math.max(totalVolume, 1);
  const attentionShockScore = clamp01(attentionShockRaw / ATTENTION_FULL_SCORE);
  const urgencyScore = getUrgencyScore(market);
  const topicScore = getTopicScore(text);
  const badLiquidityPenalty = clamp01(1 - liquidity / LOW_LIQUIDITY_THRESHOLD);
  const sportsPenalty = getSportsPenalty(text);
  const score = clamp01(
    0.3 * uncertaintyScore +
      0.25 * priceMove.score +
      0.2 * attentionShockScore +
      0.15 * urgencyScore +
      0.1 * topicScore -
      0.25 * badLiquidityPenalty -
      0.2 * sportsPenalty
  );

  return {
    market,
    pair,
    score,
    components: {
      uncertaintyScore,
      priceMoveScore: priceMove.score,
      priceMoveRaw: priceMove.raw,
      attentionShockScore,
      attentionShockRaw,
      urgencyScore,
      topicScore,
      badLiquidityPenalty,
      sportsPenalty,
      liquidity
    }
  };
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchPriceHistories(tokenIds) {
  const historyByTokenId = {};
  const uniqueTokenIds = [...new Set(tokenIds.filter(Boolean))];

  for (const chunk of chunkItems(uniqueTokenIds, 20)) {
    const response = await fetch("https://clob.polymarket.com/batch-prices-history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        markets: chunk,
        interval: "1w",
        fidelity: 60
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      continue;
    }

    const payload = await response.json();
    Object.assign(historyByTokenId, payload.history || {});
  }

  return historyByTokenId;
}

function formatScore(value) {
  return `${Math.round(value * 100)}/100`;
}

function formatPercentagePoints(value) {
  return `${Math.round(value * 100)} pts`;
}

function formatScoreBreakdown(scoredMarket) {
  const { components } = scoredMarket;

  return [
    `Selected by Interesting Score ${formatScore(scoredMarket.score)}.`,
    `Uncertainty ${formatScore(components.uncertaintyScore)}`,
    `move ${formatPercentagePoints(components.priceMoveRaw)}`,
    `attention ${formatScore(components.attentionShockScore)}`,
    `urgency ${formatScore(components.urgencyScore)}`,
    `topic ${formatScore(components.topicScore)}`,
    `liquidity ${formatUsd(components.liquidity) || "n/a"}.`
  ].join(" ");
}

function normalizeMarket(scoredMarket) {
  const { market, components, score } = scoredMarket;

  return {
    id: market.id,
    title: market.question,
    subtitle: formatScoreBreakdown(scoredMarket),
    link: buildPolymarketLink(market.slug),
    image: market.image || null,
    metricValue: formatScore(score),
    liquidityValue: formatPercentagePoints(components.priceMoveRaw),
    probabilitySummary: getProbabilitySummary(market)
  };
}

async function fetchCandidateMarkets() {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "100");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Polymarket request failed with status ${response.status}.`);
  }

  const payload = await response.json();

  return Array.isArray(payload) ? payload : [];
}

export async function getHotBetBucket() {
  const markets = (await fetchCandidateMarkets())
    .filter((item) => item.active && !item.closed && item.acceptingOrders)
    .filter(hasDisplayableProbability)
    .filter(hasFutureEndDate);
  const tokenIds = markets.map((market) => getPrimaryOutcomePair(market)?.tokenId);
  const historyByTokenId = await fetchPriceHistories(tokenIds);
  const scoredMarket = markets
    .map((market) => scoreMarket(market, historyByTokenId))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)[0];

  if (!scoredMarket) {
    throw new Error("Polymarket did not return an eligible scored market.");
  }

  return {
    provider: "polymarket-gamma",
    item: normalizeMarket(scoredMarket),
    caption: "Selected by Interesting Score: uncertainty, price move, attention shock, urgency, topic, liquidity, and sports/spam penalty."
  };
}
