import { useEffect, useState } from "react"
import { Navigate, BrowserRouter as Router, Route, Routes } from "react-router-dom"
import Layout from "./components/Layout"
import Home from "./pages/Home"
import Login from "./pages/Login"
import Profile from "./pages/Profile"
import Register from "./pages/Register"
import AdminWorkspace from "./pages/AdminWorkspace"
import VendorWorkspace from "./pages/VendorWorkspace"
import Orders from "./pages/Orders"
import { api, getAccessToken } from "./lib/api"
import type { UserProfile } from "./types/api"

function RequireAuth({ children }: { children: React.ReactNode }) {
  return getAccessToken() ? children : <Navigate replace to="/login" />
}

function RequireRole({
  roles,
  children,
}: {
  roles: UserProfile["role"][]
  children: React.ReactNode
}) {
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined)
  useEffect(() => {
    api<UserProfile>("/api/auth/me").then(setProfile).catch(() => setProfile(null))
  }, [])
  if (profile === undefined) return <div className="loading-state">Checking access…</div>
  return profile && roles.includes(profile.role) ? children : <Navigate replace to="/" />
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<RequireAuth><Home /></RequireAuth>} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
          <Route path="vendor" element={<RequireAuth><RequireRole roles={["vendor"]}><VendorWorkspace /></RequireRole></RequireAuth>} />
          <Route path="admin" element={<RequireAuth><RequireRole roles={["admin", "super_admin"]}><AdminWorkspace /></RequireRole></RequireAuth>} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
