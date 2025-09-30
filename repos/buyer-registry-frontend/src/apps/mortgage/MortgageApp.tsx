import { ThreadList, type MessageThread } from "@apps/shared/messaging/ThreadList";

const leads = [
  {
    id: "lead-001",
    buyerAlias: "First-time buyer", 
    location: "Toronto East",
    budget: 650000,
    timeline: "3-6 months",
    preApprovalStatus: "Not pre-approved"
  },
  {
    id: "lead-002",
    buyerAlias: "Relocating family",
    location: "Ottawa West",
    budget: 720000,
    timeline: "0-3 months",
    preApprovalStatus: "Pre-qualified"
  }
];

const leadThreads: MessageThread[] = [
  {
    id: "thread-lead-001",
    participants: [
      { id: "lender-001", alias: "You", role: "lender" },
      { id: "buyer-001", alias: "First-time buyer", role: "buyer" }
    ],
    subject: "Financing options for Toronto East wishlist",
    lastMessageSnippet: "We can review your documents this week.",
    updatedAt: "2024-05-05T11:00:00Z"
  }
];

export const MortgageApp = () => (
  <section>
    <h2>Mortgage lead desk</h2>
    <p>
      Licensed mortgage agents view buyers who opted into financing outreach and
      can respond via secure messaging. Sensitive data stays within the
      platform.
    </p>
    <table className="card">
      <thead>
        <tr>
          <th>Buyer alias</th>
          <th>Location</th>
          <th>Budget</th>
          <th>Timeline</th>
          <th>Pre-approval</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((lead) => (
          <tr key={lead.id}>
            <td>{lead.buyerAlias}</td>
            <td>{lead.location}</td>
            <td>CAD {lead.budget.toLocaleString()}</td>
            <td>{lead.timeline}</td>
            <td>{lead.preApprovalStatus}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="card">
      <h3>Recent conversations</h3>
      <ThreadList threads={leadThreads} />
    </div>
  </section>
);
