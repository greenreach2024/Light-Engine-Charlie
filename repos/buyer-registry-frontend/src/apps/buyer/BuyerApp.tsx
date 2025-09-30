import { Route, Routes } from "react-router-dom";
import { BuyerDashboard } from "./Dashboard";
import { WishlistBuilder } from "./WishlistBuilder";
import { WishlistDetail } from "./WishlistDetail";
import { MatchResults } from "./MatchResults";
import { BuyerMessages } from "./Messages";

export const BuyerApp = () => {
  return (
    <Routes>
      <Route index element={<BuyerDashboard />} />
      <Route path="dashboard" element={<BuyerDashboard />} />
      <Route path="wishlists" element={<WishlistBuilder />} />
      <Route path="wishlists/new" element={<WishlistBuilder />} />
      <Route path="wishlists/:wishlistId" element={<WishlistDetail />} />
      <Route path="matches" element={<MatchResults />} />
      <Route path="messages" element={<BuyerMessages />} />
    </Routes>
  );
};
