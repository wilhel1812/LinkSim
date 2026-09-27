export const getUiErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw.replace(/^\d+\s+[A-Za-z ]+:\s*/u, "").trim();
  if (/^(?:load failed|failed to fetch|networkerror\b)/iu.test(cleaned)) {
    return "LinkSim could not reach the service. Check your connection, reload the page, and try again.";
  }
  return cleaned || "LinkSim could not complete that action. Try again.";
};
