import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@shared/components/AppShell";
import { BuyerApp } from "@apps/buyer/BuyerApp";
import { SellerApp } from "@apps/seller/SellerApp";
import { AgentApp } from "@apps/agent/AgentApp";
import { DeveloperApp } from "@apps/developer/DeveloperApp";
import { MortgageApp } from "@apps/mortgage/MortgageApp";
import { AdminApp } from "@apps/admin/AdminApp";

const App = () => {
  return (
    <AppShell>
      <Routes>
        <Route path="/buyer/*" element={<BuyerApp />} />
        <Route path="/seller/*" element={<SellerApp />} />
        <Route path="/agent" element={<AgentApp />} />
        <Route path="/developer" element={<DeveloperApp />} />
        <Route path="/mortgage" element={<MortgageApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/buyer" replace />} />
      </Routes>
    </AppShell>
  );
};

export default App;
