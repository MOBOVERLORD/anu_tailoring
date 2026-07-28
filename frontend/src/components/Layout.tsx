import { useEffect, useRef, useState } from "react"
import { Heart, LogOut, Menu, UserRound, X } from "lucide-react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Toaster, toast } from "react-hot-toast"
import { api, clearSession, getAccessToken, onAuthChange } from "@/lib/api"
import type { UserProfile } from "@/types/api"
import { Brand } from "./Brand"
import { ModeToggle } from "./ThemeToggle"

const Layout = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getAccessToken()))
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const profileMenu = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => onAuthChange(() => setIsAuthenticated(Boolean(getAccessToken()))), [])

  useEffect(() => {
    setIsAuthenticated(Boolean(getAccessToken()))
    setMobileOpen(false)
    setProfileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null)
      return
    }
    api<UserProfile>("/api/auth/me").then(setProfile).catch(() => setProfile(null))
  }, [isAuthenticated, location.pathname])

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!profileMenu.current?.contains(event.target as Node)) setProfileOpen(false)
    }
    document.addEventListener("mousedown", closeMenu)
    return () => document.removeEventListener("mousedown", closeMenu)
  }, [])

  const handleLogout = () => {
    clearSession()
    toast.success("You’re signed out")
    navigate("/login")
  }

  const initials = profile?.full_name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "AT"

  return (
    <div className="app-shell">
      <Toaster
        position="bottom-center"
        toastOptions={{
          className: "app-toast",
          duration: 3500,
        }}
      />
      <header className="app-header">
        <div className="header-inner">
          <Brand />
          {isAuthenticated ? (
            <>
              <nav className={`main-nav ${mobileOpen ? "is-open" : ""}`} aria-label="Main navigation">
                <Link className={location.pathname === "/" ? "active" : ""} to="/">
                  Designs
                </Link>
                <Link
                  className={location.search.includes("favorites") ? "active" : ""}
                  to="/?view=favorites"
                >
                  <Heart size={16} />
                  Favorites
                </Link>
              </nav>
              <div className="header-actions">
                <ModeToggle />
                <div className="profile-menu" ref={profileMenu}>
                  <button
                    aria-expanded={profileOpen}
                    aria-haspopup="menu"
                    className="avatar-button"
                    onClick={() => setProfileOpen((open) => !open)}
                    type="button"
                  >
                    <span className="avatar">{initials}</span>
                    <span className="avatar-copy">
                      <strong>{profile?.full_name || "My account"}</strong>
                      <small>View profile</small>
                    </span>
                  </button>
                  {profileOpen && (
                    <div className="profile-popover" role="menu">
                      <div className="profile-popover-head">
                        <span className="avatar large">{initials}</span>
                        <div>
                          <strong>{profile?.full_name || "My account"}</strong>
                          <small>{profile?.email}</small>
                        </div>
                      </div>
                      <Link role="menuitem" to="/profile">
                        <UserRound size={17} />
                        Profile & settings
                      </Link>
                      <button role="menuitem" onClick={handleLogout} type="button">
                        <LogOut size={17} />
                        Log out
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className="icon-button mobile-menu-button"
                  onClick={() => setMobileOpen((open) => !open)}
                  type="button"
                  aria-label="Toggle navigation"
                >
                  {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              </div>
            </>
          ) : (
            <div className="header-actions">
              <ModeToggle />
              {location.pathname !== "/login" && (
                <Link className="button button-small" to="/login">Sign in</Link>
              )}
            </div>
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
