import { ArrowLeft, ExternalLink, MapPinned, Network, Radio, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ActionButton } from "./ActionButton";
import { AvatarBadge } from "./AvatarBadge";
import { InfoTip } from "./InfoTip";
import { StatsDensityMap } from "./StatsDensityMap";
import { UserProfileModal } from "./UserProfileModal";
import { fetchUserById, type CloudUser } from "../lib/cloudUser";
import { getUiErrorMessage } from "../lib/uiError";
import { fetchStats, type StatsGrowthBucket, type StatsPayload } from "../lib/stats";
import { useThemeVariant } from "../hooks/useThemeVariant";

type GrowthMode = "today" | "last7Days" | "last30Days" | "lastYear" | "allTime";

const formatNumber = (value: number): string => new Intl.NumberFormat("en").format(value);
const formatDecimal = (value: number): string => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
const formatKm = (value: number): string => `${formatDecimal(value)} km`;

const chartColors = {
  users: "var(--stats-series-users)",
  sites: "var(--stats-series-sites)",
  simulations: "var(--stats-series-simulations)",
  links: "var(--stats-series-links)",
};

const growthLabels: Record<GrowthMode, string> = {
  today: "Today",
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  lastYear: "Last year",
  allTime: "All time",
};

const rangeOptions = Object.entries(growthLabels) as Array<[GrowthMode, string]>;

const formatRelativeTime = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown signup time";
  const diffMs = date.getTime() - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  const [unit, unitMs] = units.find(([, size]) => Math.abs(diffMs) >= size) ?? ["minute", 1000 * 60];
  return formatter.format(Math.round(diffMs / unitMs), unit);
};

const CustomTooltip = ({ active, label, payload }: { active?: boolean; label?: string; payload?: Array<{ name?: string; value?: number; color?: string }> }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="ui-surface-pill stats-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.name} style={{ "--series-color": entry.color } as CSSProperties}>
          {entry.name}: {formatNumber(Number(entry.value ?? 0))}
        </span>
      ))}
    </div>
  );
};

const passingPathLeaderboardInfo =
  "A Path appears here after a logged-in user calculates a public/shared saved Simulation Path or selected two-site Path with no drag preview, terrain loading complete for the whole Simulation, real terrain for every profile sample, and RX after environment loss meeting the signal target. Only the global top five unique endpoint pairs are shown.";

const Panel = ({
  title,
  children,
  className = "",
  actions,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) => (
  <article className={`stats-atlas-panel panel-section ${className}`.trim()}>
    <div className="section-heading stats-atlas-panel-heading">
      <h2>{title}</h2>
      {actions}
    </div>
    {children}
  </article>
);

const MetricCard = ({
  label,
  value,
  delta,
  icon: Icon,
}: {
  label: string;
  value: number;
  delta: number;
  icon: typeof Users;
}) => (
  <article className="stats-atlas-metric">
    <div className="stats-atlas-metric-icon" aria-hidden="true">
      <Icon size={18} />
    </div>
    <div>
      <span className="stats-atlas-metric-value">{formatNumber(value)}</span>
      <span className="stats-atlas-metric-label">{label}</span>
    </div>
    <span className="stats-atlas-delta">{delta > 0 ? `+${formatNumber(delta)}` : "No new"}</span>
  </article>
);

const sumGrowth = (buckets: StatsGrowthBucket[], key: "users" | "sites" | "simulations" | "links") =>
  buckets.reduce((sum, bucket) => sum + bucket[key], 0);

const GrowthChart = ({ buckets, label }: { buckets: StatsGrowthBucket[]; label: string }) => {
  if (!buckets.length) {
    return <div className="stats-empty">Growth appears after dated community activity is available.</div>;
  }
  return (
    <div className="stats-chart-shell">
      <ResponsiveContainer height={280} width="100%">
        <LineChart data={buckets} margin={{ top: 10, right: 18, bottom: 18, left: 4 }}>
          <CartesianGrid stroke="var(--panel-shell-divider)" strokeDasharray="3 7" vertical={false} />
          <XAxis dataKey="label" minTickGap={22} stroke="var(--muted)" tickLine={false} />
          <YAxis stroke="var(--muted)" tickLine={false} width={42} />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" />
          <Line dataKey="cumulativeUsers" dot={false} name="Users" stroke={chartColors.users} strokeWidth={3} type="monotone" />
          <Line dataKey="cumulativeSites" dot={false} name="Sites" stroke={chartColors.sites} strokeWidth={3} type="monotone" />
          <Line dataKey="cumulativeSimulations" dot={false} name="Simulations" stroke={chartColors.simulations} strokeWidth={3} type="monotone" />
          <Line dataKey="cumulativeLinks" dot={false} name="Links" stroke={chartColors.links} strokeWidth={3} type="monotone" />
        </LineChart>
      </ResponsiveContainer>
      <p className="stats-chart-range">{label} · UTC · X: time · Y: cumulative count</p>
    </div>
  );
};

const SizeBucketsChart = ({ buckets }: { buckets: StatsPayload["complexity"]["sizeBuckets"] }) => {
  const data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  return (
    <>
      <ResponsiveContainer height={180} width="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 10, left: -18 }}>
          <CartesianGrid stroke="var(--panel-shell-divider)" strokeDasharray="3 7" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} />
          <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar dataKey="count" fill={chartColors.simulations} name="Simulations" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="stats-chart-range">X: Sites per Simulation · Y: Simulations</p>
    </>
  );
};

const DistanceChart = ({ buckets }: { buckets: StatsPayload["linkDistanceDistribution"] }) => {
  if (!buckets.some((bucket) => bucket.count > 0)) {
    return <div className="stats-empty is-compact">Link distances appear after saved Links have endpoints with coordinates.</div>;
  }
  return (
    <>
      <ResponsiveContainer height={180} width="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 10, left: -18 }}>
          <CartesianGrid stroke="var(--panel-shell-divider)" strokeDasharray="3 7" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} />
          <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar dataKey="count" fill={chartColors.links} name="Links" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="stats-chart-range">X: Link distance · Y: Links</p>
    </>
  );
};

export function StatsPage() {
  const { theme, colorTheme, variant, activeHolidayTheme } = useThemeVariant();
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [growthMode, setGrowthMode] = useState<GrowthMode>("last30Days");
  const [profileUser, setProfileUser] = useState<CloudUser | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const showProfileModal = profileBusy || profileStatus || profileUser;

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

  const openUserProfile = async (userId: string) => {
    setProfileUser(null);
    setProfileStatus("");
    setProfileBusy(true);
    try {
      setProfileUser(await fetchUserById(userId));
    } catch (error) {
      setProfileStatus(`Failed loading user: ${getUiErrorMessage(error)}`);
    } finally {
      setProfileBusy(false);
    }
  };

  const closeUserProfile = () => {
    setProfileUser(null);
    setProfileStatus("");
    setProfileBusy(false);
  };

  const activeGrowth = useMemo(() => stats?.growth[growthMode] ?? [], [growthMode, stats]);

  return (
    <main className="stats-page stats-atlas-page">
      <header className="stats-atlas-header">
        <div className="stats-atlas-title">
          <a className="btn stats-back-link" href="/">
            <ArrowLeft aria-hidden="true" size={16} />
            Back to app
          </a>
          <h1>Stats</h1>
          <p>Public aggregate signals from entered Sites, saved Simulations, and community growth.</p>
        </div>
        <div className="stats-range-stack">
          <p className="stats-active-range">Showing: {growthLabels[growthMode]} · UTC</p>
          <div className="chip-group stats-range-control" aria-label="Stats time range">
            {rangeOptions.map(([mode, label]) => (
              <ActionButton
                aria-pressed={growthMode === mode}
                className={growthMode === mode ? "is-selected" : ""}
                key={mode}
                onClick={() => setGrowthMode(mode)}
                type="button"
              >
                {label}
              </ActionButton>
            ))}
          </div>
        </div>
      </header>

      {status === "error" ? (
        <section className="stats-panel panel-section">
          <h2>Stats unavailable</h2>
          <p className="field-help field-help-error">{errorMessage}</p>
        </section>
      ) : null}

      <section className="stats-atlas-metrics" aria-label="Community totals">
        <MetricCard delta={sumGrowth(activeGrowth, "users")} icon={Users} label="Users" value={stats?.totals.users ?? 0} />
        <MetricCard delta={sumGrowth(activeGrowth, "sites")} icon={MapPinned} label="Sites" value={stats?.totals.sites ?? 0} />
        <MetricCard delta={sumGrowth(activeGrowth, "simulations")} icon={Network} label="Simulations" value={stats?.totals.simulations ?? 0} />
        <MetricCard delta={sumGrowth(activeGrowth, "links")} icon={Radio} label="Links" value={stats?.totals.links ?? 0} />
      </section>

      <section className="stats-atlas-grid">
        <Panel className="stats-atlas-map-panel" title="Site Geography">
          <p className="field-help">Binned density from user-entered Site coordinates. Hover or tap a cluster for the coarse area count.</p>
          {status === "loading" || !stats ? (
            <div className="stats-map-skeleton">Loading Site density...</div>
          ) : (
            <StatsDensityMap
              accentColor={variant.cssVars["--accent"] ?? ""}
              bins={stats.geography.bins}
              colorTheme={colorTheme}
              surfaceColor={variant.cssVars["--surface"] ?? ""}
              theme={theme}
            />
          )}
        </Panel>

        <Panel className="stats-atlas-side-panel" title="Contributor Highlights">
          <div className="stats-person-list">
            {(stats?.highlights.topContributors ?? []).map((user) => (
              <button className="stats-person-row" key={user.userId} onClick={() => void openUserProfile(user.userId)} type="button">
                <AvatarBadge avatarUrl={user.avatarUrl} imageClassName="profile-avatar" name={user.username} />
                <span>{user.username}</span>
                <span className="stats-contribution-count">
                  <strong>{formatNumber(user.contributions)}</strong>
                  <small>Sites + Simulations</small>
                </span>
              </button>
            ))}
            {!stats?.highlights.topContributors.length ? <p className="field-help">Contributor highlights appear after community resources are saved.</p> : null}
          </div>
        </Panel>

        <Panel className="stats-atlas-wide-panel" title="Growth over time">
          <GrowthChart buckets={activeGrowth} label={growthLabels[growthMode]} />
        </Panel>

        <Panel title="Latest Simulations">
          <div className="stats-simulation-list">
            {(stats?.latestSimulations ?? []).map((simulation, index) =>
              simulation.visibility === "private" ? (
                <div className="stats-simulation-row" key={`private-${index}`}>
                  <span>
                    <strong>Private Simulation</strong>
                    <small>Details anonymized</small>
                  </span>
                  <span>{simulation.siteCount} Sites</span>
                  <span>{simulation.linkCount} Paths</span>
                  <span aria-hidden="true" />
                </div>
              ) : (
                <a className="stats-simulation-row" href={simulation.href} key={simulation.id}>
                  <span>
                    <strong>{simulation.name}</strong>
                    <small>by {simulation.owner.username}</small>
                  </span>
                  <span>{simulation.siteCount} Sites</span>
                  <span>{simulation.linkCount} Paths</span>
                  <ExternalLink aria-hidden="true" size={15} />
                </a>
              ),
            )}
            {!stats?.latestSimulations.length ? <p className="field-help">Latest non-empty Simulations will appear here.</p> : null}
          </div>
        </Panel>

        <Panel title="Simulation Complexity">
          <div className="stats-complexity-grid">
            <span><strong>{formatDecimal(stats?.complexity.averageSitesPerSimulation ?? 0)}</strong>Avg. Sites</span>
            <span><strong>{formatDecimal(stats?.complexity.averageLinksPerSimulation ?? 0)}</strong>Avg. Links</span>
          </div>
          <p className="field-help">Excludes empty Simulations with no Sites.</p>
        </Panel>

        <Panel title="Simulations by Size">
          <SizeBucketsChart buckets={stats?.complexity.sizeBuckets ?? { "1-2": 0, "3-5": 0, "6-10": 0, "11+": 0 }} />
        </Panel>

        <Panel title="Link Distance Distribution">
          <DistanceChart buckets={stats?.linkDistanceDistribution ?? []} />
        </Panel>

        <Panel title="Top Passing Paths" actions={<InfoTip text={passingPathLeaderboardInfo} />}>
          <div className="stats-simulation-list">
            {(stats?.longestPassingPaths ?? []).map((path) => (
              <a className="stats-simulation-row" href={path.href || path.simulationHref} key={path.id}>
                <span>
                  <strong>{path.label}</strong>
                  <small>{path.simulationName} · by {path.owner.username}</small>
                </span>
                <span>{formatKm(path.distanceKm)}</span>
                <span>+{formatDecimal(path.rxMarginDb)} dB</span>
                <ExternalLink aria-hidden="true" size={15} />
              </a>
            ))}
            {!stats?.longestPassingPaths.length ? <p className="field-help">Passing Paths appear after terrain-backed public/shared Simulation Paths are calculated.</p> : null}
          </div>
        </Panel>

        <Panel title="Newest Members">
          <div className="stats-person-list">
            {(stats?.highlights.newestMembers ?? []).map((user) => (
              <button className="stats-person-row" key={user.userId} onClick={() => void openUserProfile(user.userId)} type="button">
                <AvatarBadge avatarUrl={user.avatarUrl} imageClassName="profile-avatar" name={user.username} />
                <span>{user.username}</span>
                <span className="stats-person-meta">{formatRelativeTime(user.createdAt)}</span>
              </button>
            ))}
            {!stats?.highlights.newestMembers.length ? <p className="field-help">Newest members appear after users join.</p> : null}
          </div>
        </Panel>
      </section>

      {showProfileModal ? (
        <UserProfileModal busy={profileBusy} onClose={closeUserProfile} status={profileStatus} user={profileUser} />
      ) : null}
    </main>
  );
}
