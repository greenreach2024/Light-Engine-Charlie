const wishlistAnalytics = {
  id: "wish-001",
  name: "Family home in Oakville",
  areas: ["Oakville", "South Etobicoke"],
  matches: 12,
  averagePrice: 914000,
  featureDemand: [
    { feature: "3+ bedrooms", percent: 78 },
    { feature: "Garage", percent: 64 },
    { feature: "Near schools", percent: 58 }
  ],
  timelines: [
    { label: "0-3 months", buyers: 4 },
    { label: "3-6 months", buyers: 5 },
    { label: "6-12 months", buyers: 3 }
  ]
};

export const WishlistDetail = () => {
  return (
    <section>
      <h2>{wishlistAnalytics.name}</h2>
      <p>
        Insights are generated from the matches table and refreshed whenever a
        listing or wishlist changes. Replace this placeholder with analytics data
        fetched from the API once endpoints are ready.
      </p>
      <div className="card">
        <strong>{wishlistAnalytics.matches} matching listings</strong>
        <span>Average price: CAD {wishlistAnalytics.averagePrice.toLocaleString()}</span>
        <span>Preferred areas: {wishlistAnalytics.areas.join(", ")}</span>
      </div>
      <div className="card">
        <h3>Feature demand</h3>
        <ul>
          {wishlistAnalytics.featureDemand.map((row) => (
            <li key={row.feature}>
              {row.feature}: {row.percent}% of matched listings
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Buyer timelines</h3>
        <ul>
          {wishlistAnalytics.timelines.map((row) => (
            <li key={row.label}>
              {row.label}: {row.buyers} buyers
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
