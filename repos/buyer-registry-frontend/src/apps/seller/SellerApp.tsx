import { Route, Routes } from "react-router-dom";
import { SellerDashboard } from "./SellerDashboard";
import { ListingWizard } from "./ListingWizard";
import { SellerMessages } from "./SellerMessages";

export const SellerApp = () => {
  return (
    <Routes>
      <Route index element={<SellerDashboard />} />
      <Route path="dashboard" element={<SellerDashboard />} />
      <Route path="listings/new" element={<ListingWizard />} />
      <Route path="messages" element={<SellerMessages />} />
    </Routes>
  );
};
