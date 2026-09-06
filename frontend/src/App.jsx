import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CreateBountyPage from './pages/CreateBountyPage.jsx';
import BountyDetailPage from './pages/BountyDetailPage.jsx';

// Strip trailing slash so BrowserRouter treats '/bountybot/' as ''.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export default function App() {
  return (
    <BrowserRouter basename={BASE}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/create" element={<CreateBountyPage />} />
        <Route path="/bounty/:id" element={<BountyDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
