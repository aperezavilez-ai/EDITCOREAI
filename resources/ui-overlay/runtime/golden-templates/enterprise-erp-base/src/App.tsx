import { BrowserRouter, Route, Routes } from "react-router-dom";
import { EnterpriseShell } from "@/layout/EnterpriseShell";
import { Dashboard } from "@/pages/Dashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<EnterpriseShell />}>
          <Route path="/" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
