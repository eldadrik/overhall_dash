"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { hasHebrewCharacters, normalizeStatusTone } from "@/lib/format";

const STATUS_LABELS = {
  ok: "פעיל",
  warning: "חלקי",
  partial: "חלקי",
  loading: "Loading",
  error: "לא זמין"
};

const PROVIDER_LABELS = {
  "google-trends-rss": "Google Trends RSS",
  "x-official-trends": "API רשמי של X",
  "xai-web-search-fallback": "xAI חיפוש רשת",
  "xai-x-search-fallback": "xAI X Search",
  "grok-x-search": "Grok X Search",
  "polymarket-gamma": "Polymarket Gamma",
  loading: "Loading",
  unavailable: "לא זמין"
};

function PanelHeader({ eyebrow, title, caption, tone = "ok" }) {
  return (
    <div className="panel-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <span className={`status-pill status-pill--${normalizeStatusTone(tone)}`}>{STATUS_LABELS[tone] || tone}</span>
      {caption ? <p className="panel-caption">{caption}</p> : null}
    </div>
  );
}

function TrendList({ items, emptyMessage, localeTag, variant = "default" }) {
  if (!items.length) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ol className={`trend-list trend-list--${variant}`}>
      {items.map((item, index) => {
        const dir = item.dir || (hasHebrewCharacters(item.title) ? "rtl" : "ltr");

        return (
          <li className="trend-item" key={`${localeTag}-${item.id ?? item.title}-${index}`}>
            <div className="trend-rank">{String(index + 1).padStart(2, "0")}</div>
            <div className="trend-content">
              <div className="trend-heading-row">
                <a className="trend-title" dir={dir} href={item.link} rel="noreferrer" target="_blank">
                  {item.title}
                </a>
                {item.metricValue ? <span className="trend-metric">{item.metricValue}</span> : null}
              </div>
              {item.subtitle ? (
                <p className="trend-subtitle" dir={dir}>
                  {item.subtitle}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TrendPanel({ eyebrow, title, bucket, localeTag, emptyMessage, initialVisibleCount, showMoreLabel = "Show more tags", variant = "default" }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasExpandableItems = initialVisibleCount && bucket.items.length > initialVisibleCount;
  const visibleItems = hasExpandableItems && !isExpanded ? bucket.items.slice(0, initialVisibleCount) : bucket.items;
  const panelEmptyMessage = bucket.status === "loading" ? "Loading X trends..." : emptyMessage;

  return (
    <section className={`panel card panel--${variant}`}>
      <PanelHeader eyebrow={eyebrow} title={title} caption={bucket.caption} tone={bucket.status} />
      <TrendList items={visibleItems} emptyMessage={panelEmptyMessage} localeTag={localeTag} variant={variant} />
      {hasExpandableItems ? (
        <button className="show-more-button" onClick={() => setIsExpanded((value) => !value)} type="button">
          {isExpanded ? "Show fewer" : `${showMoreLabel} (${bucket.items.length - initialVisibleCount})`}
        </button>
      ) : null}
    </section>
  );
}

function formatProbability(value) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedProbability(value) {
  const roundedValue = Math.round(value * 100);

  if (roundedValue > 0) {
    return `+${roundedValue} pts`;
  }

  return `${roundedValue} pts`;
}

function formatChartDate(value) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function buildChartGeometry(history) {
  const width = 100;
  const height = 100;
  const padding = {
    top: 10,
    right: 2,
    bottom: 8,
    left: 2
  };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const prices = history.map((point) => point.price);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const spread = rawMax - rawMin;
  const guard = Math.max(0.02, spread * 0.18);
  const min = Math.max(0, rawMin - guard);
  const max = Math.min(1, rawMax + guard);
  const domain = max - min || 1;
  const baseline = padding.top + chartHeight;
  const points = history.map((point, index) => {
    const x = history.length === 1 ? padding.left + chartWidth / 2 : padding.left + (index / (history.length - 1)) * chartWidth;
    const y = padding.top + ((max - point.price) / domain) * chartHeight;

    return {
      ...point,
      x,
      y
    };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`
      : "";

  return {
    width,
    height,
    baseline,
    min,
    max,
    points,
    ticks: [max, (max + min) / 2, min].map((value) => ({
      value,
      y: padding.top + ((max - value) / domain) * chartHeight
    })),
    linePath,
    areaPath
  };
}

function PriceHistoryChart({ history }) {
  const points = Array.isArray(history)
    ? history
        .filter((point) => point && Number.isFinite(point.price) && Number.isFinite(Date.parse(point.time)))
        .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
    : [];

  if (!points.length) {
    return null;
  }

  const geometry = buildChartGeometry(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const firstLabel = formatChartDate(firstPoint.time);
  const lastLabel = formatChartDate(lastPoint.time);
  const latestPriceLabel = formatProbability(lastPoint.price);
  const change = lastPoint.price - firstPoint.price;
  const changeTone = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const firstGeometryPoint = geometry.points[0];
  const latestGeometryPoint = geometry.points[geometry.points.length - 1];

  return (
    <div className="price-chart" dir="ltr">
      <div className="price-chart-head">
        <div>
          <p className="eyebrow">Polymarket Price</p>
          <h3>Last Week</h3>
        </div>
        <div className="price-chart-summary">
          <div>
            <span>Start</span>
            <strong>{formatProbability(firstPoint.price)}</strong>
          </div>
          <div>
            <span>Latest</span>
            <strong>{latestPriceLabel}</strong>
          </div>
          <div>
            <span>Move</span>
            <strong className={`price-chart-change price-chart-change--${changeTone}`}>{formatSignedProbability(change)}</strong>
          </div>
        </div>
      </div>
      <div className="price-chart-plot">
        <svg aria-label="Selected market price history" className="price-chart-svg" preserveAspectRatio="none" role="img" viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
          <defs>
            <linearGradient id="price-chart-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geometry.ticks.map((tick) => (
            <line className="price-chart-grid" key={tick.value} x1="0" x2="100" y1={tick.y} y2={tick.y} />
          ))}
          {geometry.areaPath ? <path className="price-chart-area" d={geometry.areaPath} /> : null}
          {geometry.linePath ? <path className="price-chart-line" d={geometry.linePath} /> : null}
          <line className="price-chart-end-marker" x1={firstGeometryPoint.x} x2={firstGeometryPoint.x} y1={firstGeometryPoint.y - 4} y2={firstGeometryPoint.y + 4} />
          <line className="price-chart-end-marker price-chart-end-marker--latest" x1={latestGeometryPoint.x} x2={latestGeometryPoint.x} y1={latestGeometryPoint.y - 5} y2={latestGeometryPoint.y + 5} />
        </svg>
        <div className="price-chart-axis-labels" aria-hidden="true">
          {geometry.ticks.map((tick) => (
            <span key={tick.value} style={{ top: `${tick.y}%` }}>
              {formatProbability(tick.value)}
            </span>
          ))}
        </div>
        <div className="price-chart-foot">
          <span>{firstLabel}</span>
          <span>{lastLabel}</span>
        </div>
      </div>
    </div>
  );
}

function HotBetPanel({ hotBet }) {
  if (!hotBet.item) {
    return (
      <section className="hero card">
        <PanelHeader eyebrow="פולימרקט" title="ההימור החם" caption={hotBet.caption} tone={hotBet.status} />
        <p className="empty-state">כרגע אין נתוני שוק זמינים.</p>
      </section>
    );
  }

  const { item } = hotBet;

  return (
    <section className="hero card">
      <PanelHeader eyebrow="פולימרקט" title="ההימור החם" caption={hotBet.caption} tone={hotBet.status} />
      <div className="hero-grid">
        <div className="hero-copy">
          <a className="hero-title" href={item.link} rel="noreferrer" target="_blank">
            {item.title}
          </a>
          <p className="hero-description">{item.subtitle}</p>
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-label">Interesting Score</span>
              <strong>{item.metricValue}</strong>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-label">Price move</span>
              <strong>{item.liquidityValue}</strong>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-label">Probability</span>
              <strong>{item.probabilitySummary}</strong>
            </div>
          </div>
        </div>
        {item.image ? (
          <a className="hero-image-wrap" href={item.link} rel="noreferrer" target="_blank">
            <Image alt={item.title} className="hero-image" fill sizes="(max-width: 1024px) 100vw, 32vw" src={item.image} unoptimized />
          </a>
        ) : null}
      </div>
      <PriceHistoryChart history={item.priceHistory} />
    </section>
  );
}

function WarningStrip({ warnings }) {
  if (!warnings.length) {
    return null;
  }

  return (
    <section className="warning-strip card">
      <p className="eyebrow">התראות</p>
      <ul>
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

function GrokActions({ createdAt, isAsking, isLoading, onAskAgain }) {
  const isBusy = isAsking || isLoading;
  const statusText = isLoading
    ? "Loading X trends..."
    : createdAt
      ? `Created at ${new Date(createdAt).toLocaleString()}`
      : "No saved Grok result yet";

  return (
    <section className="grok-actions card">
      <div>
        <p className="eyebrow">Grok X Search</p>
        <p>{statusText}</p>
      </div>
      <button className="cost-button" disabled={isBusy} onClick={onAskAgain} title="Uses a paid xAI request" type="button">
        <span aria-hidden="true">₪</span>
        {isAsking ? "Asking..." : isLoading ? "Loading..." : "Ask again"}
      </button>
    </section>
  );
}

function isActiveBucket(bucket) {
  return Boolean(bucket) && bucket.status !== "error" && bucket.status !== "loading";
}

function countActiveXBuckets(dashboard) {
  return [
    dashboard?.xTrends?.he,
    dashboard?.xTrends?.en,
    dashboard?.economicXTrends?.he,
    dashboard?.economicXTrends?.en
  ].filter(isActiveBucket).length;
}

function mergeXTrendsPayload(dashboard, payload) {
  if (!dashboard || !payload?.xTrends || !payload?.economicXTrends) {
    return dashboard;
  }

  const currentXActive = countActiveXBuckets(dashboard);
  const nextXActive =
    payload.summary?.activePanels ??
    [payload.xTrends.he, payload.xTrends.en, payload.economicXTrends.he, payload.economicXTrends.en].filter(isActiveBucket).length;

  return {
    ...dashboard,
    xTrends: payload.xTrends,
    economicXTrends: payload.economicXTrends,
    summary: {
      ...dashboard.summary,
      activePanels: Math.max(0, dashboard.summary.activePanels - currentXActive) + nextXActive
    },
    sources: {
      ...dashboard.sources,
      xTrends: payload.sources?.xTrends ?? dashboard.sources.xTrends,
      economicXTrends: payload.sources?.economicXTrends ?? dashboard.sources.economicXTrends
    }
  };
}

function markXTrendsUnavailable(dashboard, message) {
  if (!dashboard) {
    return dashboard;
  }

  const currentXActive = countActiveXBuckets(dashboard);
  const bucket = {
    status: "error",
    caption: message,
    items: []
  };

  return {
    ...dashboard,
    xTrends: {
      he: bucket,
      en: bucket
    },
    economicXTrends: {
      he: bucket,
      en: bucket
    },
    summary: {
      ...dashboard.summary,
      activePanels: Math.max(0, dashboard.summary.activePanels - currentXActive)
    },
    sources: {
      ...dashboard.sources,
      xTrends: {
        he: "unavailable",
        en: "unavailable"
      },
      economicXTrends: {
        he: "unavailable",
        en: "unavailable"
      }
    }
  };
}

export default function HomePage() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState(null);
  const [xWarnings, setXWarnings] = useState([]);
  const [xError, setXError] = useState(null);
  const [isLoadingXTrends, setIsLoadingXTrends] = useState(false);
  const [isAskingGrok, setIsAskingGrok] = useState(false);

  const loadXTrends = useCallback(async ({ refreshGrok = false, shouldApply = () => true } = {}) => {
    if (refreshGrok) {
      setIsAskingGrok(true);
    } else {
      setIsLoadingXTrends(true);
    }

    try {
      const url = refreshGrok ? "/api/x-trends?refresh=1" : "/api/x-trends";
      const response = await fetch(url, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`X trends request failed with status ${response.status}.`);
      }

      const payload = await response.json();

      if (!shouldApply()) {
        return;
      }

      setDashboard((current) => mergeXTrendsPayload(current, payload));
      setXWarnings(payload.warnings || []);
      setXError(null);
    } catch (loadError) {
      if (!shouldApply()) {
        return;
      }

      setXWarnings([]);
      setXError(loadError);
      setDashboard((current) => markXTrendsUnavailable(current, loadError.message));
    } finally {
      if (!shouldApply()) {
        return;
      }

      if (refreshGrok) {
        setIsAskingGrok(false);
      } else {
        setIsLoadingXTrends(false);
      }
    }
  }, []);

  const loadDashboard = useCallback(async ({ forceRefresh = false, shouldApply = () => true } = {}) => {
    try {
      const url = forceRefresh ? "/api/dashboard?refresh=1" : "/api/dashboard";
      const response = await fetch(url, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Dashboard request failed with status ${response.status}.`);
      }

      const payload = await response.json();

      if (!shouldApply()) {
        return;
      }

      setDashboard(payload);
      setError(null);
      setXWarnings([]);
      setXError(null);
      void loadXTrends({ shouldApply });
    } catch (loadError) {
      if (!shouldApply()) {
        return;
      }

      setError(loadError);
    }
  }, [loadXTrends]);

  useEffect(() => {
    let isMounted = true;

    void loadDashboard({ shouldApply: () => isMounted });

    return () => {
      isMounted = false;
    };
  }, [loadDashboard]);

  const generatedAtLabel = dashboard ? new Date(dashboard.generatedAt).toLocaleString() : "טוען...";
  const activePanelsLabel = dashboard ? `${dashboard.summary.activePanels} / 7` : "טוען...";
  const grokCreatedAt =
    dashboard?.xTrends?.he?.createdAt ||
    dashboard?.xTrends?.en?.createdAt ||
    dashboard?.economicXTrends?.he?.createdAt ||
    dashboard?.economicXTrends?.en?.createdAt;
  const combinedWarnings = [...(dashboard?.warnings ?? []), ...xWarnings, ...(xError ? [`X trends: ${xError.message}`] : [])];

  return (
    <main className="shell">
      <section className="masthead">
        <div className="masthead-copy">
          <p className="kicker">דופק הטרנדים</p>
          <h1>דשבורד טרנדים</h1>
          <p className="lede">
            מגמות חיפוש של Google, שיחה בזמן אמת ב־X דרך Grok, והימור פולימרקט שנבחר לפי ציון עניין.
          </p>
        </div>
        <div className="masthead-meta card">
          <p className="eyebrow">תמונת מצב</p>
          <dl>
            <div>
              <dt>עודכן</dt>
              <dd>{generatedAtLabel}</dd>
            </div>
            <div>
              <dt>חלון מטמון</dt>
              <dd>10 דקות</dd>
            </div>
            <div>
              <dt>פאנלים פעילים</dt>
              <dd>{activePanelsLabel}</dd>
            </div>
          </dl>
        </div>
      </section>

      {error ? (
        <section className="warning-strip card">
          <p className="eyebrow">שגיאה</p>
          <p className="empty-state">{error.message}</p>
        </section>
      ) : null}

      {dashboard ? (
        <>
          <section className="section-block section-block--google">
            <div className="section-block-head">
              <p className="eyebrow">Google Trends</p>
              <h2>מגמות חיפוש</h2>
            </div>
            <div className="google-grid">
              <TrendPanel
                bucket={dashboard.searches.he}
                eyebrow="חיפושי Google"
                emptyMessage="מגמות החיפוש בעברית אינן זמינות כרגע."
                initialVisibleCount={5}
                localeTag="search-he"
                showMoreLabel="Show more Google tags"
                title="ישראל / עברית"
                variant="google"
              />
              <TrendPanel
                bucket={dashboard.searches.en}
                eyebrow="חיפושי Google"
                emptyMessage="מגמות החיפוש באנגלית אינן זמינות כרגע."
                initialVisibleCount={5}
                localeTag="search-en"
                showMoreLabel="Show more Google tags"
                title="ארה״ב / אנגלית"
                variant="google"
              />
            </div>
          </section>

          <GrokActions createdAt={grokCreatedAt} isAsking={isAskingGrok} isLoading={isLoadingXTrends} onAskAgain={() => loadXTrends({ refreshGrok: true })} />

          <section className="grid trend-grid">
            <TrendPanel
              bucket={dashboard.xTrends.he}
              eyebrow="מגמות X"
              emptyMessage="מגמות X בעברית אינן זמינות כרגע."
              localeTag="x-he"
              title="ישראל / עברית"
            />
            <TrendPanel
              bucket={dashboard.xTrends.en}
              eyebrow="מגמות X"
              emptyMessage="מגמות X באנגלית אינן זמינות כרגע."
              localeTag="x-en"
              title="ארה״ב / אנגלית"
            />
          </section>

          <section className="grid trend-grid">
            <TrendPanel
              bucket={dashboard.economicXTrends.he}
              eyebrow="Economic X Trends"
              emptyMessage="Economic X trends in Hebrew are not available right now."
              localeTag="economic-x-he"
              title="ישראל / עברית"
            />
            <TrendPanel
              bucket={dashboard.economicXTrends.en}
              eyebrow="Economic X Trends"
              emptyMessage="Economic X trends in English are not available right now."
              localeTag="economic-x-en"
              title="ארה״ב / אנגלית"
            />
          </section>

          <WarningStrip warnings={combinedWarnings} />

          <section className="sources card">
            <div className="sources-head">
              <p className="eyebrow">מקורות</p>
              <p>כל פאנל מציג גם את המקור שהפיק את הנתונים הנוכחיים שלו.</p>
            </div>
            <div className="sources-grid">
              <div>
                <span>חיפוש / ישראל</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.searches.he] || dashboard.sources.searches.he}</strong>
              </div>
              <div>
                <span>חיפוש / ארה״ב</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.searches.en] || dashboard.sources.searches.en}</strong>
              </div>
              <div>
                <span>X / ישראל</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.xTrends.he] || dashboard.sources.xTrends.he}</strong>
              </div>
              <div>
                <span>X / ארה״ב</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.xTrends.en] || dashboard.sources.xTrends.en}</strong>
              </div>
              <div>
                <span>Economic X / ישראל</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.economicXTrends.he] || dashboard.sources.economicXTrends.he}</strong>
              </div>
              <div>
                <span>Economic X / ארה״ב</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.economicXTrends.en] || dashboard.sources.economicXTrends.en}</strong>
              </div>
              <div>
                <span>פולימרקט</span>
                <strong>{PROVIDER_LABELS[dashboard.sources.hotBet] || dashboard.sources.hotBet}</strong>
              </div>
            </div>
          </section>

          <HotBetPanel hotBet={dashboard.hotBet} />
        </>
      ) : !error ? (
        <section className="panel card">
          <PanelHeader eyebrow="טוען" title="מעדכן נתונים" caption="הדשבורד נטען ברקע דרך API ייעודי." tone="partial" />
          <p className="empty-state">העמוד מוכן, הנתונים יופיעו מיד אחרי שהספקים יחזירו תשובה.</p>
        </section>
      ) : null}
    </main>
  );
}
