export type Channel = "IN_APP" | "EMAIL" | "PUSH";
export type Audience = "owner" | "org-admins";

export type NotificationSpec = {
  type: string;
  audience: Audience;
  channels: Channel[];
  title: (payload: Record<string, unknown>) => string;
  body: (payload: Record<string, unknown>) => string;
};

/**
 * Code-based rule registry: domain event type -> notification specs. This is
 * the seam for a future DB-backed, org-configurable rules engine; the consumer
 * doesn't care where rules come from.
 */
const RULES: Record<string, NotificationSpec[]> = {
  "org.registered": [
    {
      type: "welcome",
      audience: "owner",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Welcome to RetainIQ",
      body: (p) => `Your organization ${str(p.orgName, "your org")} is ready to go.`,
    },
  ],
  "employee.created": [
    {
      type: "employee.created",
      audience: "org-admins",
      channels: ["IN_APP"],
      title: () => "New employee added",
      body: (p) => `${str(p.firstName, "An employee")} ${str(p.lastName, "")}`.trim() + " was added to your organization.",
    },
  ],
};

export function rulesFor(eventType: string): NotificationSpec[] {
  return RULES[eventType] ?? [];
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
