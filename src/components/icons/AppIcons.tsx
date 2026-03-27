type SyncStatusIconProps = {
  state: "local" | "offline" | "pending" | "syncing" | "synced" | "error";
  className?: string;
};

export function SyncStatusIcon({ state, className }: SyncStatusIconProps) {
  if (state === "error" || state === "offline") {
    return (
      <svg aria-hidden className={className} viewBox="0 0 20 20">
        <path d="M10 2.5l8 14H2l8-14z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M10 7v4.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
        <circle cx="10" cy="14.5" r="1" fill="currentColor" />
      </svg>
    );
  }

  if (state === "pending") {
    return (
      <svg aria-hidden className={className} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 10V4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
        <path d="M10 10l4.2 2.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
      </svg>
    );
  }

  if (state === "syncing") {
    return (
      <svg aria-hidden className={className} viewBox="0 0 20 20">
        <path d="M4 10a6 6 0 0 1 10.2-4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M14.4 3.6h2.6v2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M16 10a6 6 0 0 1-10.2 4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M5.6 16.4H3v-2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (state === "local") {
    return (
      <svg aria-hidden className={className} viewBox="0 0 20 20">
        <path d="M3 9.2L10 3l7 6.2v7H3v-7z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M8 16.2v-4h4v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg aria-hidden className={className} viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.6 10.1l2.3 2.3 4.5-4.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
    </svg>
  );
}

type SettingsIconProps = {
  className?: string;
};

export function SettingsIcon({ className }: SettingsIconProps) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 20 20">
      <path d="M10 4.2l1.2.3.8-1.4 2 1.2-.5 1.5.9.9 1.5-.5 1.2 2-.4.8-.4.8 1.3.9v2.4l-1.3.9.4.8.4.8-1.2 2-1.5-.5-.9.9.5 1.5-2 1.2-.8-1.4L10 15.8l-1.2.3-.8 1.4-2-1.2.5-1.5-.9-.9-1.5.5-1.2-2 .4-.8.4-.8-1.3-.9V9l1.3-.9-.4-.8-.4-.8 1.2-2 1.5.5.9-.9-.5-1.5 2-1.2.8 1.4L10 4.2z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
