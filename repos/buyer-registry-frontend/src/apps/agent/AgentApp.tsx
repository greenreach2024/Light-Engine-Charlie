const heatmapSummary = [
  { area: "Downtown Toronto", activeBuyers: 212, avgBudget: 1020000 },
  { area: "Surrey Central", activeBuyers: 134, avgBudget: 760000 },
  { area: "Ottawa West", activeBuyers: 88, avgBudget: 640000 }
];

const topWishlists = [
  {
    alias: "Transit-friendly condo",
    matchCount: 4,
    highlight: "Wants 2 bed, budget $800k, 3-6 month timeline"
  },
  {
    alias: "Growing family home",
    matchCount: 3,
    highlight: "Requires yard and near schools"
  }
];

export const AgentApp = () => (
  <section>
    <h2>Agent analytics console</h2>
    <p>
      Licensed agents unlock regional demand analytics, wishlist drill-downs,
      and proactive matching tools. Replace these mock datasets with API calls
      backed by the analytics service layer.
    </p>
    <div className="card">
      <h3>Demand heatmap snapshot</h3>
      <ul>
        {heatmapSummary.map((row) => (
          <li key={row.area}>
            {row.area}: {row.activeBuyers} active buyers · Avg budget CAD
            {row.avgBudget.toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
    <div className="card">
      <h3>Top wishlists</h3>
      <ul>
        {topWishlists.map((wishlist) => (
          <li key={wishlist.alias}>
            <strong>{wishlist.alias}</strong> – {wishlist.matchCount} of your
            listings align · {wishlist.highlight}
          </li>
        ))}
      </ul>
    </div>
  </section>
);
