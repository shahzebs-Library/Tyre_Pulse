import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import TyreRecords from './pages/TyreRecords'
import StockManagement from './pages/StockManagement'
import Budgets from './pages/Budgets'
import CorrectiveActions from './pages/CorrectiveActions'
import RcaRecords from './pages/RcaRecords'
import UploadData from './pages/UploadData'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/tyres" element={<TyreRecords />} />
                    <Route path="/stock" element={<StockManagement />} />
                    <Route path="/budgets" element={<Budgets />} />
                    <Route path="/actions" element={<CorrectiveActions />} />
                    <Route path="/rca" element={<RcaRecords />} />
                    <Route path="/upload" element={<UploadData />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
