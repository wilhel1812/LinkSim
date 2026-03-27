import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudSync, Settings } from "lucide-react";

type SyncStatusIconProps = {
  state: "local" | "offline" | "pending" | "syncing" | "synced" | "error";
  className?: string;
  title: string;
};

export function SyncStatusIcon({ state, className, title }: SyncStatusIconProps) {
  const iconProps = {
    "aria-label": title,
    className,
    role: "img" as const,
    strokeWidth: 1.8,
  };

  if (state === "offline") {
    return <CloudOff {...iconProps} />;
  }

  if (state === "pending") {
    return <Cloud {...iconProps} />;
  }

  if (state === "syncing") {
    return <CloudSync {...iconProps} />;
  }

  if (state === "local") {
    return <CloudOff {...iconProps} />;
  }

  if (state === "error") {
    return <CloudAlert {...iconProps} />;
  }

  return <CloudCheck {...iconProps} />;
}

type SettingsIconProps = {
  className?: string;
  title: string;
};

export function SettingsIcon({ className, title }: SettingsIconProps) {
  return <Settings aria-label={title} className={className} role="img" strokeWidth={1.8} />;
}
