export const toAccessVisibility = (value: unknown): "private" | "public" | "shared" => {
  if (value === "shared" || value === "public_write") return "shared";
  if (value === "public" || value === "public_read") return "public";
  return "private";
};

export const toInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};
