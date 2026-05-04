export type UiNotificationTone = "info" | "warning" | "error" | "success";
export type UiNotificationDismissMode = "auto" | "manual";

export type UiNotification = {
  id: string;
  message: string;
  tone: UiNotificationTone;
  dismissMode: UiNotificationDismissMode;
  durationMs: number;
  createdAt: number;
  pinned: boolean;
};

export type UiNotificationInput = {
  id: string;
  message: string;
  tone?: UiNotificationTone;
  dismissMode?: UiNotificationDismissMode;
  durationMs?: number;
  pinned?: boolean;
};

const DEFAULT_DURATION_MS = 5_000;

export const createUiNotification = (input: UiNotificationInput, now = Date.now()): UiNotification => ({
  id: input.id,
  message: input.message,
  tone: input.tone ?? "info",
  dismissMode: input.pinned ? "manual" : input.dismissMode ?? "auto",
  durationMs: Math.max(0, input.durationMs ?? DEFAULT_DURATION_MS),
  createdAt: now,
  pinned: input.pinned === true,
});

export const upsertUiNotification = (
  notifications: UiNotification[],
  input: UiNotificationInput,
  now = Date.now(),
): UiNotification[] => {
  const next = createUiNotification(input, now);
  const index = notifications.findIndex((item) => item.id === next.id);
  if (index === -1) return [...notifications, next];
  return notifications.map((item, itemIndex) => (itemIndex === index ? next : item));
};

export const dismissUiNotification = (
  notifications: UiNotification[],
  id: string,
  options?: { force?: boolean },
): UiNotification[] => notifications.filter((item) => item.id !== id || (item.pinned && options?.force !== true));

export const clearUiNotifications = (
  notifications: UiNotification[] = [],
  options?: { force?: boolean },
): UiNotification[] => (options?.force === true ? [] : notifications.filter((item) => item.pinned));
