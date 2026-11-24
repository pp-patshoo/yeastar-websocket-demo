import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { AiSettingsPage } from './pages/AiSettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { PbxEditPage } from './pages/PbxEditPage';
import { PbxListPage } from './pages/PbxListPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="settings/ai" element={<AiSettingsPage />} />
          <Route path="settings/pbx" element={<PbxListPage />} />
          <Route path="settings/pbx/:id" element={<PbxEditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
