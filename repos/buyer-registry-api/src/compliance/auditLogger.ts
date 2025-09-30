export type AuditEvent = {
  id: string;
  actorId: string;
  action: string;
  metadata: Record<string, unknown>;
  timestamp: string;
};

const mockAuditTrail: AuditEvent[] = [
  {
    id: "audit-001",
    actorId: "admin-001",
    action: "verified_agent",
    metadata: { agentId: "agent-789", license: "ON-123456" },
    timestamp: new Date().toISOString()
  }
];

export const recordAuditEvent = async (event: AuditEvent) => {
  // TODO: Persist to Postgres audit log table with tamper-proof controls.
  mockAuditTrail.push(event);
  return event;
};

export const listAuditEvents = async (): Promise<AuditEvent[]> => {
  // TODO: Add filtering, pagination, and role-based access controls.
  return mockAuditTrail;
};
