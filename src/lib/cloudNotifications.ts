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

export const fetchNotifications = async (): Promise<NotificationFeed> => {
  const response = await fetch("/api/notifications", {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  const json = (await response.json()) as Partial<NotificationFeed>;
  return {
    unreadCount: Number.isFinite(json.unreadCount) ? Number(json.unreadCount) : 0,
    items: Array.isArray(json.items) ? json.items : [],
  };
};
