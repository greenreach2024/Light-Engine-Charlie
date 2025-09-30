import { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import "./AppShell.css";

export const AppShell = ({ children }: PropsWithChildren) => {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <h1>Buyer Registry</h1>
        <nav>
          <Link to="/buyer">Buyer</Link>
          <Link to="/seller">Seller</Link>
          <Link to="/agent">Agent</Link>
          <Link to="/developer">Developer</Link>
          <Link to="/mortgage">Mortgage</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
};
