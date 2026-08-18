import { useEffect, useRef, useState } from "react"
import { AlertCircle, Bell, CheckCheck, CheckCircle2, ChevronRight, ClipboardList, Info, LayoutGrid, LoaderCircle, LogOut, PackageCheck, ShieldCheck, ShoppingBag, ShoppingCart, Store, Truck, UserRound, UsersRound, X } from "lucide-react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Toaster, resolveValue, toast } from "react-hot-toast"
import { api, closeSession, getAccessToken, getCurrentUser, onAuthChange } from "@/lib/api"
import type { NotificationList, UserProfile } from "@/types/api"
import { Brand } from "./Brand"
import { ApiImage } from "./ApiImage"
import { ModeToggle } from "./ThemeToggle"
import { useCart } from "@/context/CartContext"

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
  const cart = useCart()

  useEffect(() => onAuthChange(() => setIsAuthenticated(Boolean(getAccessToken()))), [])

  useEffect(() => {
    setIsAuthenticated(Boolean(getAccessToken()))
    setProfileOpen(false)
    setNotificationsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const titles: Record<string, string> = {
      "/": isAuthenticated ? "Designs" : "Custom Tailoring & Clothing Marketplace",
      "/login": "Sign in",
      "/register": "Create account",
      "/forgot-password": "Reset password",
      "/reset-password": "Choose a new password",
      "/orders": "Orders",
      "/shop": "Shop",
      "/cart": "Cart",
      "/vendors": "Vendors",
      "/profile": "Profile & settings",
      "/vendor": "Vendor studio",
      "/vendor/products": "Vendor products",
      "/vendor/sales-orders": "Vendor sales orders",
      "/admin": "Administration",
      "/delivery-agent": "Assigned deliveries",
      "/contact": "Contact us",
      "/pricing": "Pricing details",
      "/shipping": "Shipping policy",
      "/cancellation-refunds": "Cancellation & refunds",
      "/privacy": "Privacy policy",
      "/terms": "Terms and conditions",
    }
    document.title = location.pathname === "/" && !isAuthenticated
      ? "Vastrivo | Custom Tailoring & Clothing Marketplace"
      : `${titles[location.pathname] || "Vastrivo"} · Vastrivo`
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const publicDescriptions: Record<string, string> = {
      "/": "Discover custom tailoring, made-to-measure clothing, verified tailoring vendors, and ready-to-buy garments for women and men on Vastrivo.",
      "/contact": "Contact Vastrivo for help with tailoring orders, clothing purchases, payments, refunds, and delivery.",
      "/pricing": "Understand Vastrivo tailoring, product, cloth, invoice, and delivery pricing before placing an order.",
      "/shipping": "Read Vastrivo's shipping, delivery, tracking, vendor delivery, and self-pickup policy.",
      "/cancellation-refunds": "Read Vastrivo's order cancellation and Razorpay refund policy.",
      "/privacy": "Read how Vastrivo processes account, measurement, address, payment, and order information.",
      "/terms": "Read the terms governing Vastrivo customers, vendors, delivery agents, orders, and payments.",
    }
    const publicDescription = publicDescriptions[location.pathname]
    if (robots) robots.content = publicDescription ? "index, follow" : "noindex, nofollow"
    if (description) description.content = publicDescription || "Manage your Vastrivo tailoring, clothing, orders, measurements, and account."
    if (canonical) canonical.href = publicDescription
      ? `https://vastrivo.in${location.pathname === "/" ? "/" : location.pathname}`
      : `${window.location.origin}${location.pathname}`
  }, [isAuthenticated, location.pathname])

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null)
      return
    }
    getCurrentUser().then(setProfile).catch(() => setProfile(null))
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) return
    const refreshProfile = () => { void getCurrentUser(true).then(setProfile).catch(() => setProfile(null)) }
    window.addEventListener("profile:changed", refreshProfile)
    return () => window.removeEventListener("profile:changed", refreshProfile)
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
        : profile?.role === "delivery_agent"
          ? "Delivery agent"
        : "Customer"
  const notificationTime = (createdAt: string) => {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000))
    if (minutes < 1) return "Just now"
    if (minutes < 60) return `${minutes}m ago`
    if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`
    return new Date(createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  }

  const mobileWorkspace = profile?.role === "delivery_agent"
    ? { to: "/delivery-agent", label: "Deliveries", icon: <Truck size={19} />, active: location.pathname === "/delivery-agent" }
    : profile?.role === "vendor"
    ? { to: "/vendor", label: "Studio", icon: <Store size={19} />, active: location.pathname === "/vendor" || location.pathname === "/vendor/products" }
    : profile?.role === "admin" || profile?.role === "super_admin"
      ? { to: "/admin", label: "Admin", icon: <ShieldCheck size={19} />, active: location.pathname === "/admin" }
      : { to: "/shop", label: "Shop", icon: <ShoppingBag size={19} />, active: location.pathname === "/shop" }

  return (
    <div className={`app-shell ${isAuthenticated ? "has-mobile-nav" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Toaster
        containerStyle={{ bottom: "auto", top: "50%" }}
        gutter={12}
        position="top-center"
        toastOptions={{
          className: "app-toast",
          duration: 3000,
        }}
      >
        {(currentToast) => {
          const ToastIcon = currentToast.type === "success"
            ? CheckCircle2
            : currentToast.type === "error"
              ? AlertCircle
              : currentToast.type === "loading"
                ? LoaderCircle
                : Info

          return (
            <div
              {...currentToast.ariaProps}
              className={`app-toast app-toast-${currentToast.type} ${currentToast.visible ? "is-visible" : "is-hiding"}`}
            >
              <ToastIcon aria-hidden="true" className={currentToast.type === "loading" ? "spin" : ""} size={22} />
              <div className="app-toast-message">{resolveValue(currentToast.message, currentToast)}</div>
              <button
                aria-label="Close message"
                className="app-toast-close"
                onClick={() => toast.dismiss(currentToast.id)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
          )
        }}
      </Toaster>
      <header className="app-header">
        <div className="header-inner">
          <Brand />
          {isAuthenticated ? (
            <>
              <nav className="main-nav" aria-label="Main navigation">
                {profile?.role === "delivery_agent" ? (
                  <Link className={location.pathname === "/delivery-agent" ? "active" : ""} to="/delivery-agent"><Truck size={16} /> Assigned deliveries</Link>
                ) : <>
                <Link className={location.pathname === "/" ? "active" : ""} to="/">
                  Designs
                </Link>
                <Link className={location.pathname === "/shop" ? "active" : ""} to="/shop">
                  <ShoppingBag size={16} /> Shop
                </Link>
                <Link className={location.pathname === "/vendors" ? "active" : ""} to="/vendors">
                  <UsersRound size={16} /> Vendors
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
                </>}
              </nav>
              <div className="header-actions">
                {profile?.role !== "delivery_agent" && <Link aria-label={`Cart with ${cart.lines.length} items`} className={`icon-button cart-header-button ${location.pathname === "/cart" ? "active" : ""}`} to="/cart"><ShoppingCart size={19} />{cart.lines.length > 0 && <span>{cart.lines.length > 9 ? "9+" : cart.lines.length}</span>}</Link>}
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
                    <span className="avatar">{profile?.profile_image_url ? <ApiImage alt={profile.full_name} src={profile.profile_image_url} /> : initials}</span>
                    <span className="avatar-copy">
                      <strong>{profile?.full_name || "My account"}</strong>
                      <small>{profile ? roleLabel : "View profile"}</small>
                    </span>
                  </button>
                  {profileOpen && (
                    <div className="profile-popover" role="menu">
                      <div className="profile-popover-head">
                        <span className="avatar large">{profile?.profile_image_url ? <ApiImage alt={profile.full_name} src={profile.profile_image_url} /> : initials}</span>
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
      {!isAuthenticated && <footer className="public-footer"><div><Brand /><p>Custom tailoring, clothing, secure payments, and delivery coordination in one marketplace.</p></div><nav aria-label="Business and policy links"><Link to="/contact">Contact</Link><Link to="/pricing">Pricing</Link><Link to="/shipping">Shipping</Link><Link to="/cancellation-refunds">Cancellation & refunds</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav><small>© {new Date().getFullYear()} Vastrivo. All rights reserved.</small></footer>}
      {isAuthenticated && profile && (
        <nav aria-label="Mobile navigation" className="mobile-bottom-nav">
          {profile.role === "delivery_agent" ? <>
          <Link aria-current={location.pathname === "/delivery-agent" ? "page" : undefined} className={location.pathname === "/delivery-agent" ? "active" : ""} to="/delivery-agent"><Truck size={19} /><span>Deliveries</span></Link>
          <Link aria-current={location.pathname === "/profile" ? "page" : undefined} className={location.pathname === "/profile" ? "active" : ""} to="/profile"><UserRound size={19} /><span>Profile</span></Link>
          </> : <>
          <Link aria-current={location.pathname === "/" ? "page" : undefined} className={location.pathname === "/" ? "active" : ""} to="/">
            <LayoutGrid size={19} /><span>Designs</span>
          </Link>
          <Link aria-current={location.pathname === "/orders" ? "page" : undefined} className={location.pathname === "/orders" ? "active" : ""} to="/orders">
            <PackageCheck size={19} /><span>My orders</span>
          </Link>
          <Link aria-current={location.pathname === "/cart" ? "page" : undefined} className={location.pathname === "/cart" ? "active" : ""} to="/cart">
            <ShoppingCart size={19} /><span>Cart{cart.lines.length ? ` (${cart.lines.length})` : ""}</span>
          </Link>
          <Link aria-current={location.pathname === "/vendors" ? "page" : undefined} className={location.pathname === "/vendors" ? "active" : ""} to="/vendors">
            <UsersRound size={19} /><span>Vendors</span>
          </Link>
          {profile.role === "vendor" && <Link aria-current={location.pathname === "/vendor/sales-orders" ? "page" : undefined} className={location.pathname === "/vendor/sales-orders" ? "active" : ""} to="/vendor/sales-orders"><ClipboardList size={19} /><span>Sales</span></Link>}
          <Link aria-current={mobileWorkspace.active ? "page" : undefined} className={mobileWorkspace.active ? "active" : ""} to={mobileWorkspace.to}>
            {mobileWorkspace.icon}<span>{mobileWorkspace.label}</span>
          </Link>
          <Link aria-current={location.pathname === "/profile" ? "page" : undefined} className={location.pathname === "/profile" ? "active" : ""} to="/profile">
            <UserRound size={19} /><span>Profile</span>
          </Link>
          </>}
        </nav>
      )}
    </div>
  )
}

export default Layout
