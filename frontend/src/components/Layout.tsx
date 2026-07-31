import { useEffect, useRef, useState } from "react"
import { Bell, CheckCheck, Heart, LogOut, Menu, PackageCheck, ShieldCheck, Store, UserRound, X } from "lucide-react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Toaster, toast } from "react-hot-toast"
import { api, clearSession, getAccessToken, onAuthChange } from "@/lib/api"
import type { NotificationList, UserProfile } from "@/types/api"
import { Brand } from "./Brand"
import { ModeToggle } from "./ThemeToggle"

const Layout = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getAccessToken()))
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationList>({
    items: [],
    unread_count: 0,
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const profileMenu = useRef<HTMLDivElement>(null)
  const notificationMenu = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => onAuthChange(() => setIsAuthenticated(Boolean(getAccessToken()))), [])

  useEffect(() => {
    setIsAuthenticated(Boolean(getAccessToken()))
    setMobileOpen(false)
    setProfileOpen(false)
    setNotificationsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null)
      return
    }
    api<UserProfile>("/api/auth/me").then(setProfile).catch(() => setProfile(null))
  }, [isAuthenticated, location.pathname])

  useEffect(() => {
    if (!isAuthenticated) {
      setNotifications({ items: [], unread_count: 0 })
      return
    }
    let active = true
    const loadNotifications = () => {
      api<NotificationList>("/api/notifications")
        .then((result) => {
          if (active) setNotifications(result)
        })
        .catch(() => {
          // A temporary notification failure should not interrupt navigation.
        })
    }
    loadNotifications()
    const interval = window.setInterval(loadNotifications, 30_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [isAuthenticated, location.pathname])

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!profileMenu.current?.contains(event.target as Node)) setProfileOpen(false)
      if (!notificationMenu.current?.contains(event.target as Node)) setNotificationsOpen(false)
    }
    document.addEventListener("mousedown", closeMenu)
    return () => document.removeEventListener("mousedown", closeMenu)
  }, [])

  const handleLogout = () => {
    clearSession()
    toast.success("You’re signed out")
    navigate("/login")
  }

  const markAllRead = async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" })
      setNotifications((current) => ({
        unread_count: 0,
        items: current.items.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })),
      }))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const openNotification = async (notificationId: number, link: string | null) => {
    const item = notifications.items.find((notification) => notification.id === notificationId)
    if (item && !item.read_at) {
      try {
        await api(`/api/notifications/${notificationId}/read`, { method: "POST" })
        setNotifications((current) => ({
          unread_count: Math.max(0, current.unread_count - 1),
          items: current.items.map((notification) =>
            notification.id === notificationId
              ? { ...notification, read_at: new Date().toISOString() }
              : notification
          ),
        }))
      } catch (error) {
        toast.error((error as Error).message)
      }
    }
    setNotificationsOpen(false)
    if (link) navigate(link)
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
        position="top-right"
        toastOptions={{
          className: "app-toast",
          duration: 4000,
          error: { duration: 6000 },
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
                <Link className={location.pathname === "/orders" ? "active" : ""} to="/orders">
                  <PackageCheck size={16} /> Orders
                </Link>
                {profile?.role === "vendor" && (
                  <Link className={location.pathname === "/vendor" ? "active" : ""} to="/vendor">
                    <Store size={16} /> Vendor workspace
                  </Link>
                )}
                {(profile?.role === "admin" || profile?.role === "super_admin") && (
                  <Link className={location.pathname === "/admin" ? "active" : ""} to="/admin">
                    <ShieldCheck size={16} /> Administration
                  </Link>
                )}
              </nav>
              <div className="header-actions">
                <div className="notification-menu" ref={notificationMenu}>
                  <button
                    aria-expanded={notificationsOpen}
                    aria-label={`Notifications${notifications.unread_count ? `, ${notifications.unread_count} unread` : ""}`}
                    className="icon-button notification-button"
                    onClick={() => setNotificationsOpen((open) => !open)}
                    type="button"
                  >
                    <Bell size={19} />
                    {notifications.unread_count > 0 && (
                      <span>{notifications.unread_count > 9 ? "9+" : notifications.unread_count}</span>
                    )}
                  </button>
                  {notificationsOpen && (
                    <div className="notification-popover">
                      <div className="notification-heading">
                        <div><strong>Notifications</strong><small>{notifications.unread_count} unread</small></div>
                        {notifications.unread_count > 0 && (
                          <button onClick={markAllRead} type="button"><CheckCheck size={15} /> Mark all read</button>
                        )}
                      </div>
                      <div className="notification-list">
                        {notifications.items.length === 0 ? (
                          <p className="notification-empty">You’re all caught up.</p>
                        ) : notifications.items.map((notification) => (
                          <button
                            className={notification.read_at ? "" : "unread"}
                            key={notification.id}
                            onClick={() => openNotification(notification.id, notification.link)}
                            type="button"
                          >
                            <span />
                            <div>
                              <strong>{notification.title}</strong>
                              <p>{notification.message}</p>
                              <small>{new Date(notification.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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
                      <small>{profile?.role || "View profile"}</small>
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
