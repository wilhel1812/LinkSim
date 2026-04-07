import { toInitials } from "../lib/uiFormatting";

type AvatarBadgeProps = {
  name: string;
  avatarUrl?: string | null;
  imageClassName: string;
  fallbackClassName?: string;
  fallbackAs?: "span" | "div";
  fallbackRawText?: boolean;
};

export function AvatarBadge({
  name,
  avatarUrl,
  imageClassName,
  fallbackClassName,
  fallbackAs = "span",
  fallbackRawText = false,
}: AvatarBadgeProps) {
  if (avatarUrl && avatarUrl.trim()) {
    return <img alt={name} className={imageClassName} src={avatarUrl} />;
  }
  if (fallbackRawText) {
    return <>{toInitials(name)}</>;
  }
  const className = fallbackClassName ?? imageClassName;
  if (fallbackAs === "div") {
    return <div className={className}>{toInitials(name)}</div>;
  }
  return <span className={className}>{toInitials(name)}</span>;
}
