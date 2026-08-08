import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Check,
  Edit3,
  ImageIcon,
  LoaderCircle,
  MapPin,
  Maximize2,
  Ruler,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UserX,
  X,
} from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { DeliveryManagement } from "@/components/DeliveryManagement"
import { ImageLightbox } from "@/components/ImageLightbox"
import { LocationCapture } from "@/components/LocationCapture"
import MeasurementCategoriesAdmin from "@/components/MeasurementCategoriesAdmin"
import { ProductApprovals } from "@/components/ProductApprovals"
import { AppSelect } from "@/components/ui/AppSelect"
import { api, getCurrentUser } from "@/lib/api"
import type { Design, DesignImage, UserProfile } from "@/types/api"

type AdminSection = "reviews" | "products" | "vendors" | "customers" | "staff" | "measurements" | "delivery"
type AccountFilter = "all" | "active" | "inactive"
type ManageableRole = "customer" | "vendor" | "admin"
const ADMIN_CATEGORY_OPTIONS = [{ value: "all", label: "All categories" }, { value: "women", label: "Women" }, { value: "men", label: "Men" }, { value: "unisex", label: "Unisex" }, { value: "kids", label: "Kids" }]
const ACCOUNT_STATUS_OPTIONS = [{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]
const MANAGEABLE_ROLE_OPTIONS = [
  { value: "customer", label: "Customer" },
  { value: "vendor", label: "Vendor" },
  { value: "admin", label: "Administrator" },
]

interface VendorFormState {
  full_name: string
  email: string
  phone: string
  password: string
  pickup_address: string
  pickup_latitude: number | null
  pickup_longitude: number | null
}

interface ManagedUserFormState {
  full_name: string
  phone: string
  location: string
  role: ManageableRole
}

const emptyVendorForm: VendorFormState = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  pickup_address: "",
  pickup_latitude: null,
  pickup_longitude: null,
}

const AdminWorkspace = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [designs, setDesigns] = useState<Design[]>([])
  const [vendors, setVendors] = useState<UserProfile[]>([])
  const [customers, setCustomers] = useState<UserProfile[]>([])
  const [staff, setStaff] = useState<UserProfile[]>([])
  const [section, setSection] = useState<AdminSection>("reviews")
  const [reviewSearch, setReviewSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [accountSearch, setAccountSearch] = useState("")
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all")
  const [comments, setComments] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [vendorForm, setVendorForm] = useState(emptyVendorForm)
  const [creatingVendor, setCreatingVendor] = useState(false)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)
  const [userForm, setUserForm] = useState<ManagedUserFormState>({
    full_name: "",
    phone: "",
    location: "",
    role: "customer",
  })
  const [lightbox, setLightbox] = useState<{ images: DesignImage[]; index: number } | null>(null)

  const isSuperAdmin = profile?.role === "super_admin"

  const loadAdmin = useCallback(async () => {
    try {
      const [me, queue, vendorUsers, customerUsers, staffUsers] = await Promise.all([
        getCurrentUser(),
        api<Design[]>("/api/admin/designs?status=submitted"),
        api<UserProfile[]>("/api/admin/users?role=vendor"),
        api<UserProfile[]>("/api/admin/users?role=customer"),
        api<UserProfile[]>("/api/admin/users?role=admin"),
      ])
      setProfile(me)
      setDesigns(queue)
      setVendors(vendorUsers)
      setCustomers(customerUsers)
      setStaff(staffUsers)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAdmin()
  }, [loadAdmin])

  useEffect(() => {
    setAccountSearch("")
    setAccountFilter("all")
  }, [section])

  const filteredDesigns = useMemo(() => {
    const search = reviewSearch.trim().toLowerCase()
    return designs.filter((design) => {
      const matchesSearch = !search || [
        design.title,
        design.vendor_name || "",
        design.garment_type,
        design.description,
      ].some((value) => value.toLowerCase().includes(search))
      const matchesCategory = categoryFilter === "all" || design.category === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [categoryFilter, designs, reviewSearch])

  const directoryUsers = section === "vendors" ? vendors : section === "staff" ? staff : customers
  const filteredUsers = useMemo(() => {
    const search = accountSearch.trim().toLowerCase()
    return directoryUsers.filter((user) => {
      const matchesSearch = !search || [user.full_name, user.email, user.phone || ""]
        .some((value) => value.toLowerCase().includes(search))
      const matchesStatus = accountFilter === "all"
        || (accountFilter === "active" ? user.is_active : !user.is_active)
      return matchesSearch && matchesStatus
    })
  }, [accountFilter, accountSearch, directoryUsers])

  const replaceUser = (updated: UserProfile) => {
    const remove = (items: UserProfile[]) => items.filter((item) => item.id !== updated.id)
    setVendors((current) => updated.role === "vendor" ? [updated, ...remove(current)] : remove(current))
    setCustomers((current) => updated.role === "customer" ? [updated, ...remove(current)] : remove(current))
    setStaff((current) => updated.role === "admin" ? [updated, ...remove(current)] : remove(current))
  }

  const review = async (design: Design, decision: "approved" | "rejected") => {
    const comment = comments[design.id]?.trim()
    if (decision === "rejected" && !comment) {
      toast.error("Add a clear reason before rejecting this design")
      return
    }
    setBusyId(design.id)
    try {
      await api(`/api/admin/designs/${design.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comment: comment || null }),
      })
      toast.success(decision === "approved" ? "Design approved and published" : "Design returned to vendor")
      setDesigns((current) => current.filter((item) => item.id !== design.id))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const createVendor = async (event: React.FormEvent) => {
    event.preventDefault()
    setCreatingVendor(true)
    try {
      const vendor = await api<UserProfile>("/api/admin/vendors", {
        method: "POST",
        body: JSON.stringify(vendorForm),
      })
      setVendors((current) => [vendor, ...current])
      setVendorForm(emptyVendorForm)
      toast.success("Vendor account created")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCreatingVendor(false)
    }
  }

  const openEditUser = (user: UserProfile) => {
    setEditingUser(user)
    setUserForm({
      full_name: user.full_name,
      phone: user.phone || "",
      location: user.location || "",
      role: user.role as ManageableRole,
    })
  }

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingUser) return
    if (userForm.role !== editingUser.role && !window.confirm(
      `Change ${editingUser.full_name}'s role from ${editingUser.role.replace("_", " ")} to ${userForm.role.replace("_", " ")}? Their available workspace and permissions will change immediately.`,
    )) return
    setBusyId(editingUser.id)
    try {
      const updated = await api<UserProfile>(`/api/admin/users/${editingUser.id}`, {
        method: "PUT",
        body: JSON.stringify(userForm),
      })
      replaceUser(updated)
      setEditingUser(null)
      toast.success("Account details updated")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const toggleUserStatus = async (user: UserProfile) => {
    const nextStatus = !user.is_active
    setBusyId(user.id)
    try {
      const updated = await api<UserProfile>(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextStatus }),
      })
      replaceUser(updated)
      toast.success(nextStatus ? "Account activated" : "Account deactivated")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const deleteUser = async (user: UserProfile) => {
    if (!window.confirm(`Permanently delete ${user.full_name}? Accounts with designs or orders cannot be deleted.`)) return
    setBusyId(user.id)
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" })
      setVendors((current) => current.filter((item) => item.id !== user.id))
      setCustomers((current) => current.filter((item) => item.id !== user.id))
      setStaff((current) => current.filter((item) => item.id !== user.id))
      toast.success("Account deleted")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const openLightbox = (design: Design, imageId: number) => {
    const images = design.images.filter((image) => image.url)
    const index = Math.max(0, images.findIndex((image) => image.id === imageId))
    setLightbox({ images, index })
  }

  return (
    <div className="page workspace-page admin-workspace">
      <section className="workspace-heading admin-hero">
        <div>
          <p className="eyebrow"><ShieldCheck size={15} /> Administration</p>
          <h1>Marketplace control room</h1>
          <p>Review vendor submissions and manage marketplace access from one place.</p>
        </div>
        <div className="admin-role-card">
          <ShieldCheck size={18} />
          <div><strong>{isSuperAdmin ? "Super admin" : "Design admin"}</strong><small>{profile?.email}</small></div>
        </div>
      </section>

      <nav className="admin-tabs" aria-label="Administration sections">
        <button className={section === "reviews" ? "active" : ""} onClick={() => setSection("reviews")} type="button">
          <ImageIcon size={17} /> Approvals <span>{designs.length}</span>
        </button>
        <button className={section === "products" ? "active" : ""} onClick={() => setSection("products")} type="button">
          <ShoppingBag size={17} /> Shop products
        </button>
        <button className={section === "vendors" ? "active" : ""} onClick={() => setSection("vendors")} type="button">
          <Store size={17} /> Vendors <span>{vendors.length}</span>
        </button>
        <button className={section === "customers" ? "active" : ""} onClick={() => setSection("customers")} type="button">
          <Users size={17} /> Customers <span>{customers.length}</span>
        </button>
        {isSuperAdmin && <button className={section === "staff" ? "active" : ""} onClick={() => setSection("staff")} type="button">
          <UserCog size={17} /> Staff <span>{staff.length}</span>
        </button>}
        <button className={section === "measurements" ? "active" : ""} onClick={() => setSection("measurements")} type="button">
          <Ruler size={17} /> Measurements
        </button>
        <button className={section === "delivery" ? "active" : ""} onClick={() => setSection("delivery")} type="button">
          <Truck size={17} /> Delivery
        </button>
      </nav>

      {section === "reviews" ? (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><p className="eyebrow">Approval queue</p><h2>Submitted designs</h2></div>
            <div className="admin-filters">
              <label className="search-field"><Search size={17} /><input aria-label="Search approvals" onChange={(event) => setReviewSearch(event.target.value)} placeholder="Design, vendor, garment…" value={reviewSearch} /></label>
              <AppSelect ariaLabel="Filter by category" className="toolbar-select" onValueChange={setCategoryFilter} options={ADMIN_CATEGORY_OPTIONS} value={categoryFilter} />
            </div>
          </div>

          {loading ? (
            <div className="loading-state"><LoaderCircle className="spin" /> Loading review queue…</div>
          ) : filteredDesigns.length === 0 ? (
            <div className="admin-empty"><Check size={36} /><h3>No matching submissions</h3><p>Adjust the filters or wait for a vendor submission.</p></div>
          ) : (
            <div className="review-list">
              {filteredDesigns.map((design) => (
                <article className="review-card" key={design.id}>
                  <div className="review-gallery">
                    {design.images.map((image) => image.url && (
                      <button aria-label={`Zoom ${image.original_filename}`} key={image.id} onClick={() => openLightbox(design, image.id)} type="button">
                        <ApiImage alt={`${design.title} — ${image.original_filename}`} src={image.url} />
                        <span><Maximize2 size={17} /> View</span>
                      </button>
                    ))}
                  </div>
                  <div className="review-body">
                    <div className="workspace-card-title">
                      <div><span className="status-badge status-submitted">submitted</span><h3>{design.title}</h3><small>By {design.vendor_name || "Vendor"}</small></div>
                      <strong>₹{design.base_price.toLocaleString("en-IN")}</strong>
                    </div>
                    <p>{design.description}</p>
                    <div className="design-meta"><span>{design.category}</span><span>{design.garment_type}</span><span>{design.images.length} images</span></div>
                    <div className="field"><label htmlFor={`review-comment-${design.id}`}>Reviewer note</label><textarea id={`review-comment-${design.id}`} maxLength={2000} onChange={(event) => setComments({ ...comments, [design.id]: event.target.value })} placeholder="Required when rejecting; optional when approving." rows={3} value={comments[design.id] || ""} /></div>
                    <div className="review-actions">
                      <button className="button button-quiet danger" disabled={busyId === design.id} onClick={() => review(design, "rejected")} type="button"><X size={17} /> Reject</button>
                      <button className="button button-primary" disabled={busyId === design.id} onClick={() => review(design, "approved")} type="button">{busyId === design.id ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Approve & publish</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : section === "products" ? (
        <ProductApprovals />
      ) : section === "measurements" ? (
        <MeasurementCategoriesAdmin />
      ) : section === "delivery" ? (
        <DeliveryManagement isSuperAdmin={isSuperAdmin} />
      ) : (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><p className="eyebrow">Account directory</p><h2>{section === "vendors" ? "Vendor accounts" : section === "staff" ? "Administrator accounts" : "Customer accounts"}</h2></div>
            <div className="admin-filters">
              <label className="search-field"><Search size={17} /><input aria-label="Search accounts" onChange={(event) => setAccountSearch(event.target.value)} placeholder="Name, email, phone…" value={accountSearch} /></label>
              <AppSelect ariaLabel="Filter by account status" className="toolbar-select" onValueChange={(value) => setAccountFilter(value as AccountFilter)} options={ACCOUNT_STATUS_OPTIONS} value={accountFilter} />
            </div>
          </div>

          {!isSuperAdmin && <div className="permission-note"><ShieldCheck size={18} /><p><strong>Read-only directory</strong><br />Only a super admin can edit, activate, deactivate, or delete accounts.</p></div>}

          <div className={section === "vendors" ? "admin-directory-layout" : ""}>
            {section === "vendors" && (
              <aside className="vendor-onboarding-card">
                <div><UserPlus size={20} /><h3>Add verified vendor</h3><p>Create access after completing offline verification.</p></div>
                <form className="form-stack" onSubmit={createVendor}>
                  <div className="field"><label htmlFor="vendor-name">Vendor name</label><input id="vendor-name" maxLength={100} minLength={2} required value={vendorForm.full_name} onChange={(event) => setVendorForm({ ...vendorForm, full_name: event.target.value })} /></div>
                  <div className="field"><label htmlFor="vendor-email">Email</label><input autoComplete="off" id="vendor-email" maxLength={254} required type="email" value={vendorForm.email} onChange={(event) => setVendorForm({ ...vendorForm, email: event.target.value })} /></div>
                  <div className="field"><label htmlFor="vendor-phone">Phone</label><input id="vendor-phone" maxLength={20} required type="tel" value={vendorForm.phone} onChange={(event) => setVendorForm({ ...vendorForm, phone: event.target.value })} /></div>
                  <div className="field"><label htmlFor="vendor-pickup">Verified pickup address</label><textarea id="vendor-pickup" maxLength={500} minLength={10} onChange={(event) => setVendorForm({ ...vendorForm, pickup_address: event.target.value, pickup_latitude: null, pickup_longitude: null })} placeholder="Shop number, street, area, city, state and PIN code" required rows={3} value={vendorForm.pickup_address} /><small>Enter the postal address, then capture the precise shop location while you are there.</small></div>
                  <LocationCapture
                    compact
                    current={vendorForm.pickup_latitude != null && vendorForm.pickup_longitude != null ? { latitude: vendorForm.pickup_latitude, longitude: vendorForm.pickup_longitude } : null}
                    onResolved={(location) => setVendorForm((current) => ({
                      ...current,
                      pickup_address: location.formatted_address,
                      pickup_latitude: location.latitude,
                      pickup_longitude: location.longitude,
                    }))}
                  />
                  <div className="field"><label htmlFor="vendor-password">Temporary password</label><input autoComplete="new-password" id="vendor-password" maxLength={128} minLength={8} required type="password" value={vendorForm.password} onChange={(event) => setVendorForm({ ...vendorForm, password: event.target.value })} /><small>At least 8 characters with a letter and number.</small></div>
                  <button className="button button-primary button-wide" disabled={creatingVendor} type="submit"><UserPlus size={17} /> {creatingVendor ? "Creating…" : "Create vendor"}</button>
                </form>
              </aside>
            )}

            <div className="account-list">
              {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading accounts…</div> : filteredUsers.length === 0 ? (
                <div className="admin-empty"><Users size={34} /><h3>No matching accounts</h3><p>Try a different search or status filter.</p></div>
              ) : filteredUsers.map((user) => (
                <article className={`account-card ${user.is_active ? "" : "inactive"}`} key={user.id}>
                  <span className="avatar">{user.full_name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                  <div className="account-card-copy"><div><strong>{user.full_name}</strong><span className="account-role">{user.role.replace("_", " ")}</span><span className={`account-status ${user.is_active ? "active" : "inactive"}`}>{user.is_active ? "Active" : "Inactive"}</span></div><p>{user.email}</p><small>{user.phone || "No phone"}{user.location ? ` · ${user.location}` : ""}</small></div>
                  {isSuperAdmin && (
                    <div className="account-actions">
                      <button aria-label={`Edit ${user.full_name}`} className="icon-button" disabled={busyId === user.id} onClick={() => openEditUser(user)} type="button"><Edit3 size={16} /></button>
                      <button aria-label={`${user.is_active ? "Deactivate" : "Activate"} ${user.full_name}`} className="icon-button" disabled={busyId === user.id} onClick={() => toggleUserStatus(user)} type="button">{user.is_active ? <UserX size={16} /> : <UserCheck size={16} />}</button>
                      {user.role !== "admin" && <button aria-label={`Delete ${user.full_name}`} className="icon-button danger" disabled={busyId === user.id} onClick={() => deleteUser(user)} type="button"><Trash2 size={16} /></button>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {editingUser && (
        <Dialog description={`Email remains locked: ${editingUser.email}`} onClose={() => setEditingUser(null)} title={`Edit ${editingUser.role}`}>
          <form className="dialog-form form-stack" onSubmit={saveUser}>
            <div className="role-management-field">
              <div><label htmlFor="managed-role">Account role</label><small>Changes apply immediately and alter this account's workspace permissions.</small></div>
              <AppSelect id="managed-role" onValueChange={(value) => setUserForm({ ...userForm, role: value as ManageableRole })} options={MANAGEABLE_ROLE_OPTIONS} value={userForm.role} />
            </div>
            <div className="field"><label htmlFor="managed-name">Name</label><input id="managed-name" maxLength={100} minLength={2} required value={userForm.full_name} onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })} /></div>
            <div className="field"><label htmlFor="managed-phone">Phone</label><input id="managed-phone" maxLength={20} type="tel" value={userForm.phone} onChange={(event) => setUserForm({ ...userForm, phone: event.target.value })} /></div>
            <div className="field"><label htmlFor="managed-location">Location</label><input id="managed-location" maxLength={150} value={userForm.location} onChange={(event) => setUserForm({ ...userForm, location: event.target.value })} /></div>
            {userForm.role === "vendor" && editingUser.role !== "vendor" && (
              <div className="permission-note"><MapPin size={18} /><p><strong>Pickup location is completed by the vendor</strong><br />After signing in again, this user can pin their workshop address from Profile & settings.</p></div>
            )}
            <div className="dialog-actions"><button className="button button-quiet" onClick={() => setEditingUser(null)} type="button">Cancel</button><button className="button button-primary" disabled={busyId === editingUser.id} type="submit">Save changes</button></div>
          </form>
        </Dialog>
      )}

      {lightbox && (
        <ImageLightbox
          images={lightbox.images.flatMap((image) => image.url ? [{
            id: image.id,
            src: image.url,
            alt: image.original_filename,
            label: image.original_filename,
          }] : [])}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

export default AdminWorkspace
