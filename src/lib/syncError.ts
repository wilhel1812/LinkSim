export type FriendlySyncError = {
  summary: string;
  steps: string[];
};

const PRIVATE_SITE_REFERENCE_PATTERN =
  /Cannot publish\/shared simulation "([^"]+)" because it references private site "([^"]+)"\./;

const FORBIDDEN_SYNC_PATTERNS = [/\b403\b/, /forbidden/i, /access denied/i, /unauthorized/i];

export const toFriendlySyncError = (message: string | null | undefined): FriendlySyncError | null => {
  if (!message) return null;
  const privateSiteMatch = message.match(PRIVATE_SITE_REFERENCE_PATTERN);
  if (privateSiteMatch) {
    const simulationName = privateSiteMatch[1] ?? "this simulation";
    const siteName = privateSiteMatch[2] ?? "a private site";
    return {
      summary: `Simulation "${simulationName}" cannot sync because it includes private site "${siteName}".`,
      steps: [
        "Set the simulation access to Private.",
        `Or change site "${siteName}" access to Shared.`,
        "Or remove that site from the simulation.",
      ],
    };
  }
  if (FORBIDDEN_SYNC_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      summary: "Sync was rejected because you cannot write one or more resources in this change set.",
      steps: [
        "Confirm your session is still authenticated.",
        "Verify the simulation and referenced sites are writable for your account.",
        "Retry sync after fixing access or ownership constraints.",
      ],
    };
  }
  return null;
};
