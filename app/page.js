"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { hasHebrewCharacters, normalizeStatusTone } from "@/lib/format";

const STATUS_LABELS = {
  ok: "פעיל",
  warning: "חלקי",
  partial: "חלקי",
  error: "לא זמין"
};

const PROVIDER_LABELS = {
  "google-trends-rss": "Google Trends RSS",
  "x-official-trends": "API רשמי של X",
  "xai-web-search-fallback": "xAI חיפוש רשת",
  "xai-x-search-fallback": "xAI X Search",
  "grok-x-search": "Grok X Search",
  "polymarket-gamma": "Polymarket Gamma",
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

function TrendList({ items, emptyMessage, localeTag }) {
  if (!items.length) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ol className="trend-list">
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

function TrendPanel({ eyebrow, title, bucket, localeTag, emptyMessage }) {
  return (
    <section className="panel card">
      <PanelHeader eyebrow={eyebrow} title={title} caption={bucket.caption} tone={bucket.status} />
      <TrendList items={bucket.items} emptyMessage={emptyMessage} localeTag={localeTag} />
    </section>
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

export default function HomePage() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        const response = await fetch("/api/dashboard", {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(`Dashboard request failed with status ${response.status}.`);
        }

        const payload = await response.json();

        if (isMounted) {
          setDashboard(payload);
          setError(null);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError);
        }
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  const generatedAtLabel = dashboard ? new Date(dashboard.generatedAt).toLocaleString() : "טוען...";
  const activePanelsLabel = dashboard ? `${dashboard.summary.activePanels} / 5` : "טוען...";

  return (
    <main className="shell">
      <section className="masthead">
        <div className="masthead-copy">
          <p className="kicker">דופק הטרנדים</p>
          <h1>כל מוקדי תשומת הלב, בדשבורד JS אחד.</h1>
          <p className="lede">
            מגמות חיפוש של Google לישראל ולארה״ב, מגמות מבוססות מיקום ב־X, וההימור הכי חם בפולימרקט
            לפי נפח מסחר ב־24 השעות האחרונות.
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
          <section className="grid">
            <TrendPanel
              bucket={dashboard.searches.he}
              eyebrow="חיפושי Google"
              emptyMessage="מגמות החיפוש בעברית אינן זמינות כרגע."
              localeTag="search-he"
              title="ישראל / עברית"
            />
            <TrendPanel
              bucket={dashboard.searches.en}
              eyebrow="חיפושי Google"
              emptyMessage="מגמות החיפוש באנגלית אינן זמינות כרגע."
              localeTag="search-en"
              title="ארה״ב / אנגלית"
            />
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

          <WarningStrip warnings={dashboard.warnings} />

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
