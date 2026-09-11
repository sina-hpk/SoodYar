import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SettingsProvider } from "./context/SettingsContext";
import { ToastProvider } from "./components/Toast";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import MemberDetail from "./pages/MemberDetail";
import Portfolio from "./pages/Portfolio";
import NavCalc from "./pages/NavCalc";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Analytics from "./pages/Analytics";
import Audit from "./pages/Audit";
import Glossary from "./pages/Glossary";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/members" element={<Members />} />
            <Route path="/members/:id" element={<MemberDetail />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/nav" element={<NavCalc />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </ToastProvider>
    </SettingsProvider>
  );
}
