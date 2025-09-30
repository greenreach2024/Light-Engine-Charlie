import { Link } from "react-router-dom";

const wishlistSummaries = [
  {
    id: "wish-001",
    name: "Family home in Oakville",
    matches: 12,
    newMatches: 3,
    topScore: 91
  },
  {
    id: "wish-002",
    name: "Condo near transit",
    matches: 8,
    newMatches: 1,
    topScore: 87
  }
];

const notifications = [
  {
    id: "notif-001",
    message: "3 new listings match your Oakville wishlist.",
    timestamp: "2024-05-06T14:21:00Z"
  },
  {
    id: "notif-002",
    message: "Mortgage brokers are available to discuss pre-approval options.",
    timestamp: "2024-05-05T09:00:00Z"
  }
];

export const BuyerDashboard = () => {
  return (
    <section>
      <h2>Buyer dashboard</h2>
      <p>
        Review the health of your wishlists, respond to messages, and manage
        consent preferences in one place. Data shown below is mock data wired to
        future API integrations.
      </p>
      <div className="card">
        <header>
          <h3>Active wishlists</h3>
          <Link to="/buyer/wishlists/new">Create new wishlist</Link>
        </header>
        <ul>
          {wishlistSummaries.map((wishlist) => (
            <li key={wishlist.id}>
              <strong>{wishlist.name}</strong> – {wishlist.matches} matches
              (top score {wishlist.topScore}%) · {wishlist.newMatches} new this
              week
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Notifications</h3>
        <ul>
          {notifications.map((notification) => (
            <li key={notification.id}>
              {notification.message}
              <br />
              <small>{new Date(notification.timestamp).toLocaleString()}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
