const sampleMatches = [
  {
    id: "listing-123",
    address: "123 Lakeshore Rd, Oakville, ON",
    score: 92,
    price: 799000,
    highlights: ["3 bed", "Lake access", "Parking for 2"],
    timelineFit: "Move-in ready",
    featureAlignment: 0.85
  },
  {
    id: "listing-456",
    address: "456 King St W, Toronto, ON",
    score: 87,
    price: 899000,
    highlights: ["2 bed", "Transit friendly", "Amenities"],
    timelineFit: "Available in 90 days",
    featureAlignment: 0.78
  }
];

export const MatchResults = () => {
  return (
    <section>
      <h2>Top matches</h2>
      <p>
        Results are ranked by location proximity, then price fit, followed by
        feature weighting. Use this screen to shortlist listings before
        messaging sellers.
      </p>
      <div className="card">
        <strong>Active wishlist: Family home in Oakville</strong>
        <span>Weights – Location 50%, Price 30%, Features 20%</span>
        <span>Filters – Detached homes, 3+ bedrooms, garage preferred</span>
      </div>
      <ul className="match-grid">
        {sampleMatches.map((match) => (
          <li key={match.id} className="card">
            <header>
              <strong>{match.address}</strong>
              <span className="score">Score: {match.score}</span>
            </header>
            <p>Price: CAD {match.price.toLocaleString()}</p>
            <p>Feature alignment: {(match.featureAlignment * 100).toFixed(0)}%</p>
            <p>{match.timelineFit}</p>
            <ul>
              {match.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
};
