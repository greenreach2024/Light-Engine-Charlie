export const ROLES = ["buyer", "seller", "agent", "developer", "lender", "admin"] as const;

export type Role = (typeof ROLES)[number];
