const auditLog = [
  {
    id: "evt-001",
    action: "Verified agent",
    actor: "privacy.officer@buyer-registry.ca",
    timestamp: "2024-05-02T18:21:00Z"
  },
  {
    id: "evt-002",
    action: "Generated breach readiness report",
    actor: "compliance@buyer-registry.ca",
    timestamp: "2024-05-03T12:41:00Z"
  }
];

export const AdminApp = () => {
  return (
    <section>
      <h2>Administrative console</h2>
      <p>
        Admins manage verification, compliance, and audit trails under PIPEDA.
        This console will connect to secured APIs that surface identity
        approvals, breach reporting workflows, and audit exports from the
        analytics service.
      </p>
      <div className="card">
        <h3>Recent audit events</h3>
        <ul>
          {auditLog.map((event) => (
            <li key={event.id}>
              <strong>{event.action}</strong> by {event.actor} on {new Date(event.timestamp).toLocaleString()}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
