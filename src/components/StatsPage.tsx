import { useEffect, useMemo, useState } from "react";
import { ActionButton } from "./ActionButton";
import { fetchStats, type StatsGrowthBucket, type StatsPayload } from "../lib/stats";
import { useThemeVariant } from "../hooks/useThemeVariant";

type GrowthMode = "monthly" | "weekly";

const formatNumber = (value: number): string => new Intl.NumberFormat("en").format(value);

const metricLabel = (value: number, singular: string, plural = `${singular}s`): string =>
  `${formatNumber(value)} ${value === 1 ? singular : plural}`;

const StatCounter = ({ label, value, detail }: { label: string; value: number; detail: string }) => (
  <div className="stats-counter">
    <span className="stats-counter-value">{formatNumber(value)}</span>
    <span className="stats-counter-label">{label}</span>
    <span className="stats-counter-detail">{detail}</span>
  </div>
);

const EmptyPanel = ({ title, children }: { title: string; children: string }) => (
  <article className="stats-placeholder panel-section">
    <div className="section-heading">
      <h2>{title}</h2>
      <span className="stats-chip">planned</span>
    </div>
    <p className="field-help">{children}</p>
  </article>
);

const GrowthChart = ({ buckets }: { buckets: StatsGrowthBucket[] }) => {
  const width = 760;
  const height = 260;
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.cumulativeUsers + bucket.cumulativeSites + bucket.cumulativeSimulations));
  const points = buckets.map((bucket, index) => {
    const x = buckets.length <= 1 ? width / 2 : (index / (buckets.length - 1)) * width;
    const total = bucket.cumulativeUsers + bucket.cumulativeSites + bucket.cumulativeSimulations;
    const y = height - (total / maxValue) * (height - 34) - 17;
    return { x, y, total, bucket };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  if (!buckets.length) {
    return <div className="stats-empty">Stats will appear here after community data exists.</div>;
  }

  return (
    <div className="stats-chart-wrap" aria-label="Community growth chart">
      <svg className="stats-growth-chart" role="img" viewBox={`0 0 ${width} ${height}`} aria-label="Cumulative users, Sites, and Simulations over time">
        <path className="stats-chart-grid" d={`M0 ${height - 18} H${width}`} />
        <path className="stats-chart-area" d={`${path} L${width},${height - 18} L0,${height - 18} Z`} />
        <path className="stats-chart-line" d={path} />
        {points.map((point) => (
          <g key={point.bucket.label}>
            <circle className="stats-chart-dot" cx={point.x} cy={point.y} r="4" />
            <title>
              {point.bucket.label}: {metricLabel(point.bucket.users, "user")}, {metricLabel(point.bucket.sites, "Site")}, {metricLabel(point.bucket.simulations, "Simulation")}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
};

const GeoDensity = ({ stats }: { stats: StatsPayload }) => {
  const bins = stats.geography.bins.slice(0, 180);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));

  if (!bins.length) {
    return <div className="stats-empty">Site density will appear after Sites with coordinates are created.</div>;
  }

  return (
    <div className="stats-geo-wrap" aria-label="Binned Site geography">
      <svg className="stats-geo-map" role="img" viewBox="0 0 720 360" aria-label="Binned density map of entered Site locations">
        <rect className="stats-geo-frame" x="1" y="1" width="718" height="358" rx="18" />
        <path className="stats-geo-equator" d="M24 180 H696" />
        <path className="stats-geo-meridian" d="M360 24 V336" />
        {bins.map((bin) => {
          const x = ((bin.lonBand + 180) / 360) * 672 + 24;
          const y = ((90 - bin.latBand) / 180) * 312 + 24;
          const radius = 3 + (bin.count / maxCount) * 18;
          return (
            <circle
              className="stats-geo-bin"
              cx={x}
              cy={y}
              key={`${bin.latBand}:${bin.lonBand}`}
              r={radius}
            >
              <title>
                {bin.count} Sites near {bin.latBand} degrees latitude, {bin.lonBand} degrees longitude
              </title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
};

export function StatsPage() {
  const { theme, variant, activeHolidayTheme } = useThemeVariant();
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [growthMode, setGrowthMode] = useState<GrowthMode>("monthly");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    if (activeHolidayTheme) root.dataset.holidayTheme = activeHolidayTheme.key;
    else delete root.dataset.holidayTheme;
    for (const [key, value] of Object.entries(variant.cssVars)) {
      root.style.setProperty(key, value);
    }
    root.style.colorScheme = theme;
  }, [activeHolidayTheme, theme, variant]);

  useEffect(() => {
    document.title = "LinkSim Stats";
    let cancelled = false;
    setStatus("loading");
    fetchStats()
      .then((payload) => {
        if (cancelled) return;
        setStats(payload);
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Stats unavailable.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeGrowth = useMemo(() => stats?.growth[growthMode] ?? [], [growthMode, stats]);

  return (
    <main className="stats-page">
      <section className="stats-hero">
        <div className="stats-hero-copy">
          <span className="stats-kicker">LinkSim community telemetry</span>
          <h1>Stats</h1>
          <p>
            Public aggregate signals from entered Sites, saved Simulations, and community growth.
          </p>
        </div>
        <div className="stats-hero-status">
          <span className={`stats-status-dot is-${status}`} aria-hidden="true" />
          <span className="stats-chip">{status}</span>
        </div>
      </section>

      {status === "error" ? (
        <section className="stats-panel panel-section">
          <div className="section-heading">
            <h2>Stats unavailable</h2>
          </div>
          <p className="field-help field-help-error">{errorMessage}</p>
        </section>
      ) : null}

      <section className="stats-counter-grid" aria-label="Community totals">
        <StatCounter label="Users" value={stats?.totals.users ?? 0} detail="registered community members" />
        <StatCounter label="Sites" value={stats?.totals.sites ?? 0} detail="entered planning locations" />
        <StatCounter label="Simulations" value={stats?.totals.nonEmptySimulations ?? 0} detail={`${formatNumber(stats?.totals.simulations ?? 0)} total including drafts`} />
        <StatCounter label="Links" value={stats?.totals.links ?? 0} detail="saved Paths inside Simulations" />
      </section>

      <section className="stats-grid">
        <article className="stats-panel stats-panel-wide panel-section">
          <div className="section-heading stats-section-heading">
            <div>
              <h2>Growth</h2>
              <p className="field-help">Cumulative Users, Sites, and Simulations.</p>
            </div>
            <div className="chip-group">
              <ActionButton aria-pressed={growthMode === "monthly"} onClick={() => setGrowthMode("monthly")} type="button">
                All time
              </ActionButton>
              <ActionButton aria-pressed={growthMode === "weekly"} onClick={() => setGrowthMode("weekly")} type="button">
                Recent
              </ActionButton>
            </div>
          </div>
          {status === "loading" ? <div className="stats-empty">Loading growth stats...</div> : <GrowthChart buckets={activeGrowth} />}
        </article>

        <article className="stats-panel stats-panel-wide panel-section">
          <div className="section-heading stats-section-heading">
            <div>
              <h2>Site Geography</h2>
              <p className="field-help">Binned density from user-entered Site coordinates.</p>
            </div>
            <span className="stats-chip">{stats ? `${stats.geography.binSizeDegrees} degree bins` : "loading"}</span>
          </div>
          {status === "loading" || !stats ? <div className="stats-empty">Loading Site geography...</div> : <GeoDensity stats={stats} />}
        </article>

        <EmptyPanel title="Contributor Highlights">
          Planned: top 5 contributors, newest 5 members, and recent community activity using normal profile-safe fields.
        </EmptyPanel>
        <EmptyPanel title="Simulation Complexity">
          Planned: average and median Sites and Links per non-empty Simulation, plus size distribution buckets.
        </EmptyPanel>
        <EmptyPanel title="Radio And Network Flavor">
          Planned: common frequencies, bands, link distance distribution, and common presets or Channels.
        </EmptyPanel>
        <EmptyPanel title="Geography Details">
          Planned: densest regions, cardinal extent bins, and a future longest passing Path spotlight.
        </EmptyPanel>
      </section>
    </main>
  );
}
