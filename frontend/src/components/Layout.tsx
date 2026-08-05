import { useEffect, useRef, useState } from "react"
import { Bell, CheckCheck, ChevronRight, ClipboardList, Heart, LayoutGrid, LogOut, PackageCheck, ShieldCheck, ShoppingBag, Store, UserRound } from "lucide-react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Toaster, toast } from "react-hot-toast"
import { api, closeSession, getAccessToken, getCurrentUser, onAuthChange } from "@/lib/api"
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
  const profileMenu = useRef<HTMLDivElement>(null)
  const notificationMenu = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => onAuthChange(() => setIsAuthenticated(Boolean(getAccessToken()))), [])

  useEffect(() => {
    setIsAuthenticated(Boolean(getAccessToken()))
    setProfileOpen(false)
    setNotificationsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Designs",
      "/login": "Sign in",
      "/register": "Create account",
      "/orders": "Orders",
      "/shop": "Shop",
      "/profile": "Profile & settings",
      "/vendor": "Vendor studio",
      "/vendor/products": "Vendor products",
      "/vendor/sales-orders": "Vendor sales orders",
      "/admin": "Administration",
    }
    document.title = `${titles[location.pathname] || "Anu Tailoring"} · Anu Tailoring`
  }, [location.pathname])

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null)
      return
    }
    getCurrentUser().then(setProfile).catch(() => setProfile(null))
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setNotifications({ items: [], unread_count: 0 })
      return
    }
    let active = true
    let requestInFlight = false
    const loadNotifications = () => {
      if (document.visibilityState !== "visible" || requestInFlight) return
      requestInFlight = true
      api<NotificationList>("/api/notifications?unread_only=true&limit=50")
        .then((result) => {
          if (active) {
            const unreadItems = result.items.filter((item) => !item.read_at)
            setNotifications({ items: unreadItems, unread_count: result.unread_count })
          }
        })
        .catch(() => {
          // A temporary notification failure should not interrupt navigation.
        })
        .finally(() => { requestInFlight = false })
    }
    loadNotifications()
    const interval = window.setInterval(loadNotifications, 60_000)
    document.addEventListener("visibilitychange", loadNotifications)
    window.addEventListener("notifications:changed", loadNotifications)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", loadNotifications)
      window.removeEventListener("notifications:changed", loadNotifications)
    }
  }, [isAuthenticated])

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!profileMenu.current?.contains(event.target as Node)) setProfileOpen(false)
      if (!notificationMenu.current?.contains(event.target as Node)) setNotificationsOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false)
        setNotificationsOpen(false)
      }
    }
    document.addEventListener("mousedown", closeMenu)
    document.addEventListener("keydown", closeWithEscape)
    return () => {
      document.removeEventListener("mousedown", closeMenu)
      document.removeEventListener("keydown", closeWithEscape)
    }
  }, [])

  const handleLogout = async () => {
    await closeSession()
    toast.success("You’re signed out")
    navigate("/login")
  }

  const markAllRead = async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" })
      setNotifications({ unread_count: 0, items: [] })
      window.dispatchEvent(new Event("notifications:changed"))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const openNotification = async (notificationId: number, link: string | null) => {
    const item = notifications.items.find((notification) => notification.id === notificationId)
    if (item) {
      try {
        await api(`/api/notifications/${notificationId}/read`, { method: "POST" })
        setNotifications((current) => ({
          unread_count: Math.max(0, current.unread_count - 1),
          items: current.items.filter((notification) => notification.id !== notificationId),
        }))
        window.dispatchEvent(new Event("notifications:changed"))
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
  const roleLabel = profile?.role === "super_admin"
    ? "Super administrator"
    : profile?.role === "admin"
      ? "Administrator"
      : profile?.role === "vendor"
        ? "Vendor"
        : "Customer"
  const notificationTime = (createdAt: string) => {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000))
    if (minutes < 1) return "Just now"
    if (minutes < 60) return `${minutes}m ago`
    if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`
    return new Date(createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  }

  const isFavorites = location.pathname === "/" && location.search.includes("favorites")
  const mobileWorkspace = profile?.role === "vendor"
    ? { to: "/vendor", label: "Studio", icon: <Store size={19} />, active: location.pathname === "/vendor" }
    : profile?.role === "admin" || profile?.role === "super_admin"
      ? { to: "/admin", label: "Admin", icon: <ShieldCheck size={19} />, active: location.pathname === "/admin" }
      : { to: "/shop", label: "Shop", icon: <ShoppingBag size={19} />, active: location.pathname === "/shop" }

  return (
    <div className={`app-shell ${isAuthenticated ? "has-mobile-nav" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
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
              <nav className="main-nav" aria-label="Main navigation">
                <Link className={location.pathname === "/" && !isFavorites ? "active" : ""} to="/">
                  Designs
                </Link>
                <Link
                  className={isFavorites ? "active" : ""}
                  to="/?view=favorites"
                >
                  <Heart size={16} />
                  Favorites
                </Link>
                <Link className={location.pathname === "/shop" ? "active" : ""} to="/shop">
                  <ShoppingBag size={16} /> Shop
                </Link>
                <Link className={location.pathname === "/orders" ? "active" : ""} to="/orders">
                  <PackageCheck size={16} /> My orders
                </Link>
                {profile?.role === "vendor" && (
                  <>
                    <Link className={location.pathname === "/vendor" ? "active" : ""} to="/vendor"><Store size={16} /> Designs</Link>
                    <Link className={location.pathname === "/vendor/products" ? "active" : ""} to="/vendor/products"><ShoppingBag size={16} /> Products</Link>
                    <Link className={location.pathname === "/vendor/sales-orders" ? "active" : ""} to="/vendor/sales-orders"><ClipboardList size={16} /> Sales orders</Link>
                  </>
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
                        <div><strong>New notifications</strong><small>{notifications.unread_count} unread</small></div>
                        {notifications.unread_count > 0 && (
                          <button onClick={markAllRead} type="button"><CheckCheck size={15} /> Mark all read</button>
                        )}
                      </div>
                      <div className="notification-list">
                        {notifications.items.length === 0 ? (
                          <p className="notification-empty">You’re all caught up.</p>
                        ) : notifications.items.map((notification) => (
                          <button
                            className="unread"
                            key={notification.id}
                            onClick={() => openNotification(notification.id, notification.link)}
                            type="button"
                          >
                            <span />
                            <div>
                              <strong>{notification.title}</strong>
                              <p>{notification.message}</p>
                              <small>{notificationTime(notification.created_at)}</small>
                            </div>
                          </button>
                        ))}
                      </div>
                      <button
                        className="notification-activity-link"
                        onClick={() => {
                          setNotificationsOpen(false)
                          navigate("/profile?section=activity")
                        }}
                        type="button"
                      >
                        View activity log <ChevronRight size={15} />
                      </button>
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
                      <small>{profile ? roleLabel : "View profile"}</small>
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
      <main className="app-main" id="main-content">
        <Outlet />
      </main>
      {isAuthenticated && profile && (
        <nav aria-label="Mobile navigation" className="mobile-bottom-nav">
          <Link aria-current={location.pathname === "/" && !isFavorites ? "page" : undefined} className={location.pathname === "/" && !isFavorites ? "active" : ""} to="/">
            <LayoutGrid size={19} /><span>Designs</span>
          </Link>
          <Link aria-current={location.pathname === "/orders" ? "page" : undefined} className={location.pathname === "/orders" ? "active" : ""} to="/orders">
            <PackageCheck size={19} /><span>My orders</span>
          </Link>
          {profile.role === "vendor" && <Link aria-current={location.pathname === "/vendor/sales-orders" ? "page" : undefined} className={location.pathname === "/vendor/sales-orders" ? "active" : ""} to="/vendor/sales-orders"><ClipboardList size={19} /><span>Sales</span></Link>}
          <Link aria-current={mobileWorkspace.active ? "page" : undefined} className={mobileWorkspace.active ? "active" : ""} to={mobileWorkspace.to}>
            {mobileWorkspace.icon}<span>{mobileWorkspace.label}</span>
          </Link>
          <Link aria-current={location.pathname === "/profile" ? "page" : undefined} className={location.pathname === "/profile" ? "active" : ""} to="/profile">
            <UserRound size={19} /><span>Profile</span>
          </Link>
        </nav>
      )}
    </div>
  )
}

export default Layout
