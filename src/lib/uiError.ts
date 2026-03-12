export const getUiErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw.replace(/^\d+\s+[A-Za-z ]+:\s*/u, "").trim();
  return cleaned || "Unexpected error";
};
