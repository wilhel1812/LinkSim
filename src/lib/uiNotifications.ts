export type UiNotificationTone = "info" | "warning" | "error" | "success";
export type UiNotificationDismissMode = "auto" | "manual";

export type UiNotification = {
  id: string;
  message: string;
  tone: UiNotificationTone;
  dismissMode: UiNotificationDismissMode;
  durationMs: number;
  createdAt: number;
  title?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
};

export type UiNotificationInput = {
  id: string;
  message: string;
  tone?: UiNotificationTone;
  dismissMode?: UiNotificationDismissMode;
  durationMs?: number;
  title?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
};

const DEFAULT_DURATION_MS = 5_000;

export const createUiNotification = (input: UiNotificationInput, now = Date.now()): UiNotification => ({
  id: input.id,
  message: input.message,
  tone: input.tone ?? "info",
  dismissMode: input.dismissMode ?? "auto",
  durationMs: Math.max(0, input.durationMs ?? DEFAULT_DURATION_MS),
  createdAt: now,
  title: input.title,
  actions: input.actions,
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

export const dismissUiNotification = (notifications: UiNotification[], id: string): UiNotification[] =>
  notifications.filter((item) => item.id !== id);

export const clearUiNotifications = (): UiNotification[] => [];
