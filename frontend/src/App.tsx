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
import Shop from "./pages/Shop"
import VendorProducts from "./pages/VendorProducts"
import { getAccessToken, getCurrentUser } from "./lib/api"
import type { UserProfile } from "./types/api"

const textInputTypes = new Set(["text", "search", "tel", "email", "url", "password"])

function useDefaultInputLimits() {
  useEffect(() => {
    const limitElement = (element: Element) => {
      if (element instanceof HTMLTextAreaElement && !element.hasAttribute("maxlength")) element.maxLength = 3000
      if (element instanceof HTMLInputElement && textInputTypes.has(element.type) && !element.hasAttribute("maxlength")) element.maxLength = 500
    }
    const limitTree = (root: ParentNode) => {
      if (root instanceof Element) limitElement(root)
      root.querySelectorAll("input, textarea").forEach(limitElement)
    }
    limitTree(document)
    const observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) limitTree(node)
    })))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
}

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
    getCurrentUser().then(setProfile).catch(() => setProfile(null))
  }, [])
  if (profile === undefined) return <div className="loading-state">Checking access…</div>
  return profile && roles.includes(profile.role) ? children : <Navigate replace to="/" />
}

function App() {
  useDefaultInputLimits()
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<RequireAuth><Home /></RequireAuth>} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
          <Route path="shop" element={<RequireAuth><Shop /></RequireAuth>} />
          <Route path="vendor" element={<RequireAuth><RequireRole roles={["vendor"]}><VendorWorkspace /></RequireRole></RequireAuth>} />
          <Route path="vendor/products" element={<RequireAuth><RequireRole roles={["vendor"]}><VendorProducts /></RequireRole></RequireAuth>} />
          <Route path="vendor/sales-orders" element={<RequireAuth><RequireRole roles={["vendor"]}><Orders mode="sales" /></RequireRole></RequireAuth>} />
          <Route path="admin" element={<RequireAuth><RequireRole roles={["admin", "super_admin"]}><AdminWorkspace /></RequireRole></RequireAuth>} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
