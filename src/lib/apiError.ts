export const parseApiErrorMessage = async (response: Response): Promise<string> => {
  const raw = await response.text();
  if (!raw.trim()) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // Fall through to raw body.
  }
  return raw.trim();
};

