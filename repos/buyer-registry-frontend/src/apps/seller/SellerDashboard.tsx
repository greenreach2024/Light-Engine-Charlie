const sellerInsights = [
  {
    postalCode: "M4C",
    wishlists: 128,
    avgBudget: 910000,
    popularFeatures: ["Parking", "Transit", "3 bedrooms"],
    preApprovedRate: 0.68
  },
  {
    postalCode: "L6J",
    wishlists: 94,
    avgBudget: 1250000,
    popularFeatures: ["Waterfront", "Office", "Garage"],
    preApprovedRate: 0.72
  }
];

export const SellerDashboard = () => {
  const totalWishlists = sellerInsights.reduce((acc, row) => acc + row.wishlists, 0);
  const averageBudget = Math.round(
    sellerInsights.reduce((acc, row) => acc + row.avgBudget, 0) / sellerInsights.length
  );

  return (
    <section>
      <h2>Seller insights</h2>
      <p>
        Aggregated demand analytics help sellers understand how many buyers are
        searching in their neighbourhood before unlocking buyer-level matches.
      </p>
      <div className="card">
        <strong>Total wishlists tracked: {totalWishlists}</strong>
        <span>Average buyer budget: CAD {averageBudget.toLocaleString()}</span>
        <span>Upgrade to view individual buyer profiles and initiate chat.</span>
      </div>
      <table className="card">
        <thead>
          <tr>
            <th>Postal prefix</th>
            <th>Wishlists</th>
            <th>Avg. budget</th>
            <th>Pre-approved</th>
            <th>Popular features</th>
          </tr>
        </thead>
        <tbody>
          {sellerInsights.map((row) => (
            <tr key={row.postalCode}>
              <td>{row.postalCode}</td>
              <td>{row.wishlists}</td>
              <td>CAD {row.avgBudget.toLocaleString()}</td>
              <td>{(row.preApprovedRate * 100).toFixed(0)}%</td>
              <td>{row.popularFeatures.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
