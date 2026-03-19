export type FriendlySyncError = {
  summary: string;
  steps: string[];
};

const PRIVATE_SITE_REFERENCE_PATTERN =
  /Cannot publish\/shared simulation "([^"]+)" because it references private site "([^"]+)"\./;

export const toFriendlySyncError = (message: string | null | undefined): FriendlySyncError | null => {
  if (!message) return null;
  const privateSiteMatch = message.match(PRIVATE_SITE_REFERENCE_PATTERN);
  if (!privateSiteMatch) return null;
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
};
