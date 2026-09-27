import { parseApiErrorMessage } from "./apiError";

export type PendingApprovalUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  accessRequestNote: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  createdAt: string;
  meta?: {
    pendingUsers?: PendingApprovalUser[];
  };
};

export type NotificationFeed = {
  unreadCount: number;
  items: NotificationItem[];
};

const requestNotifications = async (): Promise<NotificationFeed> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("/api/notifications", {
      method: "GET",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
    });
    if (!response.ok) {
      const message = await parseApiErrorMessage(response);
      throw new Error(`${response.status} ${response.statusText}: ${message}`);
    }
    const json = (await response.json()) as Partial<NotificationFeed>;
    return {
      unreadCount: Number.isFinite(json.unreadCount) ? Number(json.unreadCount) : 0,
      items: Array.isArray(json.items) ? json.items : [],
    };
  } finally { clearTimeout(timer); }

};

// Share only in-flight requests, keyed by authenticated application identity.
// There is deliberately no response cache across sessions or role changes.
const pending = new Map<string, Promise<NotificationFeed>>();
export const fetchNotifications = (userId?: string): Promise<NotificationFeed> => {
  if (!userId) return requestNotifications();
  const existing = pending.get(userId);
  if (existing) return existing;
  const request = requestNotifications().finally(() => {
    if (pending.get(userId) === request) pending.delete(userId);
  });
  pending.set(userId, request);
  return request;
};
