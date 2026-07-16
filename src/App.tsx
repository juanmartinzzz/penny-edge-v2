import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HomePage } from "./pages/HomePage";
import { ScannersPage } from "./pages/ScannersPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="scanners" element={<ScannersPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
