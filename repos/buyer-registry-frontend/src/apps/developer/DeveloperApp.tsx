const projectDemand = [
  {
    project: "Harbourfront Residences",
    interestedBuyers: 56,
    avgBudget: 980000,
    status: "Pre-launch"
  },
  {
    project: "Greenbelt Estates",
    interestedBuyers: 41,
    avgBudget: 820000,
    status: "Taking reservations"
  }
];

export const DeveloperApp = () => (
  <section>
    <h2>Developer pipeline</h2>
    <p>
      Track buyer demand for upcoming projects and broadcast updates to buyers
      who opted in. Developers leverage the same analytics foundation as agents
      but scoped to their projects.
    </p>
    <table className="card">
      <thead>
        <tr>
          <th>Project</th>
          <th>Interested buyers</th>
          <th>Average budget</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {projectDemand.map((row) => (
          <tr key={row.project}>
            <td>{row.project}</td>
            <td>{row.interestedBuyers}</td>
            <td>CAD {row.avgBudget.toLocaleString()}</td>
            <td>{row.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);
