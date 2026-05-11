import { useEffect, useMemo, useState } from "react";
import { ActionButton } from "./ActionButton";
import { fetchStats, type StatsGrowthBucket, type StatsPayload } from "../lib/stats";
import { useThemeVariant } from "../hooks/useThemeVariant";

type GrowthMode = "monthly" | "weekly";
type MetricKey = "users" | "sites" | "simulations" | "links";

const formatNumber = (value: number): string => new Intl.NumberFormat("en").format(value);

const metricLabel = (value: number, singular: string, plural = `${singular}s`): string =>
  `${formatNumber(value)} ${value === 1 ? singular : plural}`;

const metricConfig: Record<MetricKey, { label: string; detail: string; cumulativeKey: keyof StatsGrowthBucket }> = {
  users: {
    label: "Users",
    detail: "Registered community members.",
    cumulativeKey: "cumulativeUsers",
  },
  sites: {
    label: "Sites",
    detail: "Saved planning locations.",
    cumulativeKey: "cumulativeSites",
  },
  simulations: {
    label: "Simulations",
    detail: "Saved Simulations.",
    cumulativeKey: "cumulativeSimulations",
  },
  links: {
    label: "Links",
    detail: "Saved Paths inside Simulations.",
    cumulativeKey: "cumulativeLinks",
  },
};

const EmptyPanel = ({ title, children }: { title: string; children: string }) => (
  <article className="stats-placeholder panel-section">
    <div className="section-heading">
      <h2>{title}</h2>
      <span className="stats-chip">planned</span>
    </div>
    <p className="field-help">{children}</p>
  </article>
);

const MetricChart = ({ buckets, metric }: { buckets: StatsGrowthBucket[]; metric: MetricKey }) => {
  const width = 320;
  const height = 150;
  const config = metricConfig[metric];
  const maxValue = Math.max(1, ...buckets.map((bucket) => Number(bucket[config.cumulativeKey])));
  const points = buckets.map((bucket, index) => {
    const x = buckets.length <= 1 ? width - 28 : 26 + (index / (buckets.length - 1)) * (width - 54);
    const value = Number(bucket[config.cumulativeKey]);
    const y = height - 28 - (value / maxValue) * (height - 54);
    return { x, y, value, bucket };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  if (!buckets.length) {
    return <div className="stats-mini-empty">No growth data yet.</div>;
  }

  return (
    <div className="stats-mini-chart-wrap">
      <svg className="stats-growth-chart" role="img" viewBox={`0 0 ${width} ${height}`} aria-label={`${config.label} growth over time`}>
        <text className="stats-axis-label stats-axis-label-y" x="2" y="18">Total</text>
        <text className="stats-axis-label stats-axis-label-x" x={width - 60} y={height - 4}>Time</text>
        <path className="stats-chart-grid" d={`M26 ${height - 28} H${width - 18}`} />
        <path className="stats-chart-grid stats-chart-axis-y" d={`M26 16 V${height - 28}`} />
        <path className="stats-chart-area" d={`${path} L${width - 18},${height - 28} L26,${height - 28} Z`} />
        <path className="stats-chart-line" d={path} />
        {points.map((point) => (
          <g key={point.bucket.label}>
            <circle className="stats-chart-dot" cx={point.x} cy={point.y} r="4" />
            <title>
              {point.bucket.label}: {metricLabel(point.value, config.label.slice(0, -1) || config.label)}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
};

const StatCard = ({
  buckets,
  metric,
  value,
}: {
  buckets: StatsGrowthBucket[];
  metric: MetricKey;
  value: number;
}) => {
  const config = metricConfig[metric];
  return (
    <article className="stats-counter">
      <div className="stats-counter-copy">
        <span className="stats-counter-value">{formatNumber(value)}</span>
        <span className="stats-counter-label">{config.label}</span>
        <span className="stats-counter-detail">{config.detail}</span>
      </div>
      <MetricChart buckets={buckets} metric={metric} />
    </article>
  );
};

const GeoDensity = ({ stats }: { stats: StatsPayload }) => {
  const bins = stats.geography.bins.slice(0, 180);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const minLat = Math.min(...bins.map((bin) => bin.latBand));
  const maxLat = Math.max(...bins.map((bin) => bin.latBand));
  const minLon = Math.min(...bins.map((bin) => bin.lonBand));
  const maxLon = Math.max(...bins.map((bin) => bin.lonBand));
  const rawLatSpan = maxLat - minLat;
  const rawLonSpan = maxLon - minLon;
  const latSpan = Math.max(1, rawLatSpan);
  const lonSpan = Math.max(1, rawLonSpan);

  if (!bins.length) {
    return <div className="stats-empty">Site density will appear after Sites with coordinates are created.</div>;
  }

  return (
    <div className="stats-geo-wrap" aria-label="Binned Site geography">
      <svg className="stats-geo-map" role="img" viewBox="0 0 720 360" aria-label="Binned density map of entered Site locations">
        <rect className="stats-geo-frame" x="1" y="1" width="718" height="358" rx="18" />
        <text className="stats-axis-label" x="24" y="28">North</text>
        <text className="stats-axis-label" x="24" y="342">South</text>
        <text className="stats-axis-label" x="650" y="342">East</text>
        <path className="stats-geo-equator" d="M24 180 H696" />
        <path className="stats-geo-meridian" d="M360 24 V336" />
        {bins.map((bin) => {
          const x = rawLonSpan === 0 ? 360 : ((bin.lonBand - minLon) / lonSpan) * 592 + 64;
          const y = rawLatSpan === 0 ? 180 : ((maxLat - bin.latBand) / latSpan) * 252 + 54;
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
      </section>

      {status === "error" ? (
        <section className="stats-panel panel-section">
          <div className="section-heading">
            <h2>Stats unavailable</h2>
          </div>
          <p className="field-help field-help-error">{errorMessage}</p>
        </section>
      ) : null}

      <section className="stats-growth-header">
        <div>
          <h2>Growth</h2>
          <p className="field-help">Each chart shows one cumulative metric over time.</p>
        </div>
        <div className="chip-group">
          <ActionButton aria-pressed={growthMode === "monthly"} onClick={() => setGrowthMode("monthly")} type="button">
            All time
          </ActionButton>
          <ActionButton aria-pressed={growthMode === "weekly"} onClick={() => setGrowthMode("weekly")} type="button">
            Recent
          </ActionButton>
        </div>
      </section>

      <section className="stats-counter-grid" aria-label="Community totals and growth">
        <StatCard buckets={activeGrowth} metric="users" value={stats?.totals.users ?? 0} />
        <StatCard buckets={activeGrowth} metric="sites" value={stats?.totals.sites ?? 0} />
        <StatCard buckets={activeGrowth} metric="simulations" value={stats?.totals.simulations ?? 0} />
        <StatCard buckets={activeGrowth} metric="links" value={stats?.totals.links ?? 0} />
      </section>

      <section className="stats-grid">
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
