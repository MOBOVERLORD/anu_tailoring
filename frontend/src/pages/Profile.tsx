import { useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"
import {
  BellRing,
  ChevronRight,
  CircleUserRound,
  Edit3,
  History,
  Home,
  LoaderCircle,
  MapPin,
  Plus,
  Ruler,
  Save,
  Star,
  Trash2,
  UserRound,
} from "lucide-react"
import toast from "react-hot-toast"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Dialog } from "@/components/Dialog"
import { AppSelect } from "@/components/ui/AppSelect"
import { api, getCurrentUser, updateCurrentUserCache } from "@/lib/api"
import { validMeasurementInput } from "@/lib/formLimits"
import type {
  AppNotification,
  DeliveryAddress,
  DeliveryAddressInput,
  MeasurementCategory,
  MeasurementProfile,
  MeasurementProfileInput,
  NotificationList,
  UserProfile,
} from "@/types/api"

type Section = "details" | "measurements" | "addresses" | "activity"
type Gender = "women" | "men" | "unisex" | "kids"

interface GarmentOption {
  value: string
  label: string
}

const GARMENTS: Record<"women" | "men", GarmentOption[]> = {
  women: [
    { value: "saree_blouse", label: "Saree blouse" },
    { value: "salwar_kameez", label: "Salwar / kameez" },
    { value: "lehenga", label: "Lehenga set" },
    { value: "kurta", label: "Kurta" },
    { value: "dress", label: "Dress / gown" },
  ],
  men: [
    { value: "kurta", label: "Kurta" },
    { value: "shirt", label: "Shirt" },
    { value: "trouser", label: "Trouser / pyjama" },
    { value: "sherwani", label: "Sherwani" },
  ],
}

const FIELD_LABELS: Record<string, string> = {
  bust: "Bust",
  upper_bust: "Upper bust",
  under_bust: "Under bust",
  chest: "Chest",
  waist: "Waist",
  hip: "Hip / seat",
  shoulder: "Shoulder",
  neck: "Neck round",
  armhole: "Armhole",
  bicep: "Upper arm / bicep",
  sleeve_length: "Sleeve length",
  wrist: "Wrist / cuff",
  front_neck_depth: "Front neck depth",
  back_neck_depth: "Back neck depth",
  blouse_length: "Blouse length",
  garment_length: "Garment length",
  kameez_length: "Kameez length",
  skirt_length: "Skirt length",
  thigh: "Thigh",
  knee: "Knee round",
  bottom: "Bottom / ankle round",
  inseam: "Inside leg / inseam",
  outseam: "Outside leg",
  rise: "Crotch / rise",
}

const COMMON_UPPER = ["shoulder", "neck", "armhole", "bicep", "sleeve_length", "wrist"]
const MEASUREMENT_FIELDS: Record<string, string[]> = {
  saree_blouse: ["bust", "upper_bust", "under_bust", "waist", ...COMMON_UPPER, "front_neck_depth", "back_neck_depth", "blouse_length"],
  salwar_kameez: ["bust", "waist", "hip", ...COMMON_UPPER, "kameez_length", "thigh", "knee", "bottom", "inseam", "rise"],
  lehenga: ["bust", "under_bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "blouse_length", "skirt_length"],
  kurta: ["chest", "waist", "hip", ...COMMON_UPPER, "garment_length"],
  dress: ["bust", "waist", "hip", ...COMMON_UPPER, "garment_length"],
  shirt: ["chest", "waist", "hip", ...COMMON_UPPER, "garment_length"],
  trouser: ["waist", "hip", "thigh", "knee", "bottom", "rise", "inseam", "outseam"],
  sherwani: ["chest", "waist", "hip", ...COMMON_UPPER, "garment_length"],
}

const emptyAddress: DeliveryAddressInput = {
  recipient_name: "",
  phone_number: "",
  street_address: "",
  city: "",
  state: "",
  postal_code: "",
  country: "India",
  is_default: false,
}

function MeasurementForm({
  categories,
  initial,
  onCancel,
  onSave,
}: {
  categories: MeasurementCategory[]
  initial?: MeasurementProfile
  onCancel: () => void
  onSave: (value: MeasurementProfileInput) => Promise<void>
}) {
  const initialGender = initial?.gender || categories[0]?.gender || "women"
  const [gender, setGender] = useState<Gender>(initialGender)
  const [garmentType, setGarmentType] = useState(initial?.garment_type || categories.find((category) => category.gender === initialGender)?.garment_type || "general")
  const [standardSize, setStandardSize] = useState(initial?.standard_size || "")
  const [profileName, setProfileName] = useState(initial?.profile_name || "")
  const [unit, setUnit] = useState<"inches" | "cm">(initial?.unit || "inches")
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initial?.measurements || {}).map(([key, value]) => [key, String(value)])),
  )
  const [notes, setNotes] = useState(initial?.notes || "")
  const [saving, setSaving] = useState(false)

  const selectedCategory = categories.find((category) => category.garment_type === garmentType)
  const genderCategories = categories.filter((category) => category.gender === gender)
  const availableCategories = selectedCategory && !genderCategories.some((category) => category.id === selectedCategory.id)
    ? [selectedCategory, ...genderCategories]
    : genderCategories
  const fields = selectedCategory?.measurement_fields || (MEASUREMENT_FIELDS[garmentType] || []).map((key) => ({ key, label: FIELD_LABELS[key] || key }))
  const changeGender = (value: Gender) => {
    setGender(value)
    setGarmentType(categories.find((category) => category.gender === value)?.garment_type || "general")
    setStandardSize("")
    setValues({})
  }
  const changeGarment = (value: string) => {
    setGarmentType(value)
    setStandardSize("")
    setValues({})
  }

  const changeStandardSize = (value: string) => {
    setStandardSize(value)
    if (value && selectedCategory?.standard_sizes[value]) {
      setValues(Object.fromEntries(Object.entries(selectedCategory.standard_sizes[value]).map(([key, measurement]) => [key, String(measurement)])))
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const measurements = Object.fromEntries(
      Object.entries(values)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => [key, Number(value)]),
    )
    setSaving(true)
    try {
      await onSave({
        profile_name: profileName,
        gender,
        garment_type: garmentType,
        standard_size: standardSize || null,
        unit,
        measurements,
        notes: notes || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="measurement-name">Profile name</label>
          <input
            autoFocus
            id="measurement-name"
            onChange={(event) => setProfileName(event.target.value)}
            placeholder="e.g. My festive kurta"
            required
            value={profileName}
          />
        </div>
        <div className="field">
          <label htmlFor="measurement-unit">Unit</label>
          <AppSelect id="measurement-unit" onValueChange={(value) => setUnit(value as "inches" | "cm")} options={[{ value: "inches", label: "Inches" }, { value: "cm", label: "Centimetres" }]} value={unit} />
        </div>
      </div>
      <div className="field">
        <span className="field-label">For</span>
        <div className="segmented-control fit-content">
          {(["women", "men", "unisex", "kids"] as Gender[]).filter((value) => categories.some((category) => category.gender === value)).map((value) => (
            <button className={gender === value ? "active" : ""} key={value} onClick={() => changeGender(value)} type="button">
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="garment-type">Garment</label>
        <AppSelect id="garment-type" onValueChange={changeGarment} options={availableCategories.map((category) => ({ value: category.garment_type, label: category.name }))} value={garmentType} />
      </div>
      {selectedCategory && Object.keys(selectedCategory.standard_sizes).length > 0 && (
        <div className="field">
          <label htmlFor="standard-size">Standard size <small>optional starting point</small></label>
          <AppSelect id="standard-size" onValueChange={(value) => changeStandardSize(value === "__custom__" ? "" : value)} options={[{ value: "__custom__", label: "Custom measurements" }, ...Object.keys(selectedCategory.standard_sizes).map((size) => ({ value: size, label: size }))]} value={standardSize || "__custom__"} />
          <small>Choosing a size prefills the configured values. You can adjust every measurement.</small>
        </div>
      )}
      <div className="measurement-tip">
        <Ruler size={18} />
        <p>Measure close to the body without pulling the tape tight. Use the same unit throughout.</p>
      </div>
      <div className="measurement-input-grid">
        {fields.map((field) => (
          <div className="field" key={field.key}>
            <label htmlFor={`measure-${field.key}`}>{field.label}</label>
            <div className="unit-input">
              <input
                id={`measure-${field.key}`}
                inputMode="decimal"
                max="300"
                min="0.1"
                onChange={(event) => { if (validMeasurementInput(event.target.value)) setValues((current) => ({ ...current, [field.key]: event.target.value })) }}
                placeholder="—"
                step="0.1"
                type="number"
                value={values[field.key] || ""}
              />
              <span>{unit === "inches" ? "in" : "cm"}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="measurement-notes">Fit notes <small>optional</small></label>
        <textarea
          id="measurement-notes"
          maxLength={1000}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Posture, preferred ease, asymmetry, or anything your tailor should know"
          rows={3}
          value={notes}
        />
      </div>
      <div className="dialog-actions">
        <button className="button button-secondary" onClick={onCancel} type="button">Cancel</button>
        <button className="button button-primary" disabled={saving} type="submit">
          <Save size={17} /> {saving ? "Saving…" : "Save measurements"}
        </button>
      </div>
    </form>
  )
}

function AddressForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: DeliveryAddress
  onCancel: () => void
  onSave: (value: DeliveryAddressInput) => Promise<void>
}) {
  const [form, setForm] = useState<DeliveryAddressInput>(initial || emptyAddress)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof DeliveryAddressInput>(key: K, value: DeliveryAddressInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="recipient">Recipient name</label>
          <input autoFocus id="recipient" maxLength={100} onChange={(e) => set("recipient_name", e.target.value)} required value={form.recipient_name} />
        </div>
        <div className="field">
          <label htmlFor="address-phone">Phone number</label>
          <input id="address-phone" maxLength={20} onChange={(e) => set("phone_number", e.target.value)} required type="tel" value={form.phone_number} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="street">House, building, street and area</label>
        <textarea id="street" maxLength={500} onChange={(e) => set("street_address", e.target.value)} required rows={2} value={form.street_address} />
      </div>
      <div className="form-grid three">
        <div className="field">
          <label htmlFor="city">City</label>
          <input id="city" maxLength={100} onChange={(e) => set("city", e.target.value)} required value={form.city} />
        </div>
        <div className="field">
          <label htmlFor="state">State</label>
          <input id="state" maxLength={100} onChange={(e) => set("state", e.target.value)} required value={form.state} />
        </div>
        <div className="field">
          <label htmlFor="pin">PIN code</label>
          <input id="pin" inputMode="numeric" maxLength={6} onChange={(e) => { if (/^\d{0,6}$/.test(e.target.value)) set("postal_code", e.target.value) }} pattern="[0-9]{6}" required value={form.postal_code} />
        </div>
      </div>
      <label className="checkbox-field">
        <input checked={form.is_default} onChange={(e) => set("is_default", e.target.checked)} type="checkbox" />
        <span><strong>Use as default address</strong><small>We’ll select this first during checkout.</small></span>
      </label>
      <div className="dialog-actions">
        <button className="button button-secondary" onClick={onCancel} type="button">Cancel</button>
        <button className="button button-primary" disabled={saving} type="submit">
          <Save size={17} /> {saving ? "Saving…" : "Save address"}
        </button>
      </div>
    </form>
  )
}

const Profile = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [section, setSection] = useState<Section>("details")
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileDraft, setProfileDraft] = useState({ full_name: "", phone: "", location: "" })
  const [measurements, setMeasurements] = useState<MeasurementProfile[]>([])
  const [categories, setCategories] = useState<MeasurementCategory[]>([])
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [activities, setActivities] = useState<AppNotification[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityHasMore, setActivityHasMore] = useState(false)
  const [measurementDialog, setMeasurementDialog] = useState<MeasurementProfile | "new" | null>(null)
  const [addressDialog, setAddressDialog] = useState<DeliveryAddress | "new" | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const requestedSection = searchParams.get("section")
    setSection(
      requestedSection === "measurements" || requestedSection === "addresses" || requestedSection === "activity"
        ? requestedSection
        : "details"
    )
  }, [searchParams])

  useEffect(() => {
    Promise.all([
      getCurrentUser(),
      api<MeasurementProfile[]>("/api/measurements"),
      api<DeliveryAddress[]>("/api/addresses"),
      api<MeasurementCategory[]>("/api/measurements/categories"),
    ])
      .then(([user, userMeasurements, userAddresses, measurementCategories]) => {
        setProfile(user)
        setProfileDraft({
          full_name: user.full_name,
          phone: user.phone || "",
          location: user.location || "",
        })
        setMeasurements(userMeasurements)
        setAddresses(userAddresses)
        setCategories(measurementCategories)
      })
      .catch((error: Error) => {
        toast.error(error.message)
        navigate("/login")
      })
      .finally(() => setLoading(false))
  }, [navigate])

  useEffect(() => {
    if (section !== "activity") return

    let active = true
    const loadActivity = () => {
      setActivityLoading(true)
      api<NotificationList>("/api/notifications?limit=50&offset=0")
        .then((result) => {
          if (!active) return
          setActivities(result.items)
          setActivityHasMore(result.items.length === 50)
        })
        .catch((error: Error) => {
          if (active) toast.error(error.message)
        })
        .finally(() => {
          if (active) setActivityLoading(false)
        })
    }

    loadActivity()
    window.addEventListener("notifications:changed", loadActivity)
    return () => {
      active = false
      window.removeEventListener("notifications:changed", loadActivity)
    }
  }, [section])

  const selectSection = (nextSection: Section) => {
    setSection(nextSection)
    setSearchParams(nextSection === "details" ? {} : { section: nextSection }, { replace: true })
  }

  const loadMoreActivity = async () => {
    setActivityLoading(true)
    try {
      const result = await api<NotificationList>(`/api/notifications?limit=50&offset=${activities.length}`)
      setActivities((current) => [...current, ...result.items])
      setActivityHasMore(result.items.length === 50)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setActivityLoading(false)
    }
  }

  const openActivity = async (item: AppNotification) => {
    if (!item.read_at) {
      try {
        const updated = await api<AppNotification>(`/api/notifications/${item.id}/read`, { method: "POST" })
        setActivities((current) => current.map((activity) => activity.id === updated.id ? updated : activity))
        window.dispatchEvent(new Event("notifications:changed"))
      } catch (error) {
        toast.error((error as Error).message)
        return
      }
    }
    if (item.link) navigate(item.link)
  }

  const activityTime = (value: string) => new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

  const initials = useMemo(() => profile?.full_name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "AT", [profile])

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    setSavingProfile(true)
    try {
      const updated = await api<UserProfile>("/api/auth/me", {
        method: "PUT",
        body: JSON.stringify(profileDraft),
      })
      setProfile(updated)
      updateCurrentUserCache(updated)
      toast.success("Personal details updated")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSavingProfile(false)
    }
  }

  const saveMeasurement = async (value: MeasurementProfileInput) => {
    try {
      if (measurementDialog && measurementDialog !== "new") {
        const updated = await api<MeasurementProfile>(`/api/measurements/${measurementDialog.id}`, {
          method: "PUT",
          body: JSON.stringify(value),
        })
        setMeasurements((current) => current.map((item) => item.id === updated.id ? updated : item))
      } else {
        const created = await api<MeasurementProfile>("/api/measurements", {
          method: "POST",
          body: JSON.stringify(value),
        })
        setMeasurements((current) => [...current, created])
      }
      setMeasurementDialog(null)
      toast.success("Measurement profile saved")
    } catch (error) {
      toast.error((error as Error).message)
      throw error
    }
  }

  const removeMeasurement = async (item: MeasurementProfile) => {
    if (!window.confirm(`Delete “${item.profile_name}”?`)) return
    try {
      await api<void>(`/api/measurements/${item.id}`, { method: "DELETE" })
      setMeasurements((current) => current.filter((profileItem) => profileItem.id !== item.id))
      toast.success("Measurement profile deleted")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const saveAddress = async (value: DeliveryAddressInput) => {
    try {
      if (addressDialog && addressDialog !== "new") {
        const updated = await api<DeliveryAddress>(`/api/addresses/${addressDialog.id}`, {
          method: "PUT",
          body: JSON.stringify(value),
        })
        setAddresses((current) => current.map((item) => {
          if (item.id === updated.id) return updated
          return updated.is_default ? { ...item, is_default: false } : item
        }))
      } else {
        const created = await api<DeliveryAddress>("/api/addresses", {
          method: "POST",
          body: JSON.stringify(value),
        })
        setAddresses((current) => [
          ...current.map((item) => created.is_default ? { ...item, is_default: false } : item),
          created,
        ])
      }
      setAddressDialog(null)
      toast.success("Delivery address saved")
    } catch (error) {
      toast.error((error as Error).message)
      throw error
    }
  }

  const removeAddress = async (item: DeliveryAddress) => {
    if (!window.confirm(`Delete the address in ${item.city}?`)) return
    try {
      await api<void>(`/api/addresses/${item.id}`, { method: "DELETE" })
      setAddresses((current) => current.filter((address) => address.id !== item.id))
      toast.success("Address deleted")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  if (loading || !profile) {
    return <div className="loading-state page"><LoaderCircle className="spin" size={28} /><p>Loading your profile…</p></div>
  }

  const navItems: Array<{ value: Section; label: string; detail: string; icon: typeof UserRound }> = [
    { value: "details", label: "Personal details", detail: "Name, phone & location", icon: UserRound },
    { value: "measurements", label: "Measurements", detail: `${measurements.length} saved profile${measurements.length === 1 ? "" : "s"}`, icon: Ruler },
    { value: "addresses", label: "Delivery addresses", detail: `${addresses.length} saved address${addresses.length === 1 ? "" : "es"}`, icon: Home },
    { value: "activity", label: "Activity log", detail: "Notifications & updates", icon: History },
  ]

  return (
    <div className="page profile-page">
      <section className="profile-title profile-hero">
        <div>
          <p className="eyebrow"><CircleUserRound size={15} /> Profile & settings</p>
          <h1>Your tailoring profile</h1>
          <p>Keep the contact, fit, and delivery information used for your made-to-measure orders in one place.</p>
        </div>
        <div className="profile-quick-stats" aria-label="Profile summary">
          <span><strong>{measurements.length}</strong><small>Saved fits</small></span>
          <span><strong>{addresses.length}</strong><small>Addresses</small></span>
        </div>
      </section>
      <div className="profile-layout">
        <aside className="profile-sidebar">
          <div className="profile-summary">
            <span className="avatar xlarge">{initials}</span>
            <div><strong>{profile.full_name}</strong><small>{profile.email}</small></div>
          </div>
          <nav aria-label="Profile sections">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <button className={section === item.value ? "active" : ""} key={item.value} onClick={() => selectSection(item.value)} type="button">
                  <span className="side-icon"><Icon size={18} /></span>
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                  <ChevronRight size={16} />
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="profile-content">
          {section === "details" && (
            <>
              <div className="section-heading">
                <div><p className="section-kicker">Account identity</p><h2>Contact details</h2><p>Used for account communication and tailoring updates.</p></div>
              </div>
              <form className="profile-form" onSubmit={saveProfile}>
                <div className="profile-avatar-row">
                  <span className="avatar xxlarge">{initials}</span>
                  <div><strong>{profile.full_name}</strong><p>{profile.role.replaceAll("_", " ")} account · joined {new Date(profile.created_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p></div>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="profile-name">Full name</label>
                    <input id="profile-name" maxLength={100} onChange={(e) => setProfileDraft((current) => ({ ...current, full_name: e.target.value }))} required value={profileDraft.full_name} />
                  </div>
                  <div className="field">
                    <label htmlFor="profile-email">Email address <span className="readonly-badge">Read only</span></label>
                    <input disabled id="profile-email" value={profile.email} />
                    <small>Your email is tied to your sign-in and can’t be edited here.</small>
                  </div>
                  <div className="field">
                    <label htmlFor="profile-phone">Phone number</label>
                    <input id="profile-phone" maxLength={20} onChange={(e) => setProfileDraft((current) => ({ ...current, phone: e.target.value }))} placeholder="+91 98765 43210" type="tel" value={profileDraft.phone} />
                  </div>
                  <div className="field">
                    <label htmlFor="profile-location">Location</label>
                    <div className="input-with-icon">
                      <MapPin size={17} />
                      <input id="profile-location" maxLength={150} onChange={(e) => setProfileDraft((current) => ({ ...current, location: e.target.value }))} placeholder="City, State" value={profileDraft.location} />
                    </div>
                  </div>
                </div>
                <div className="form-actions">
                  <button className="button button-primary" disabled={savingProfile} type="submit"><Save size={17} /> {savingProfile ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
            </>
          )}

          {section === "measurements" && (
            <>
              <div className="section-heading">
                <div><p className="section-kicker">Made-to-measure</p><h2>Saved fits</h2><p>Keep a separate, garment-specific fit for yourself or each family member.</p></div>
                <button className="button button-primary" onClick={() => setMeasurementDialog("new")} type="button"><Plus size={17} /> Add measurements</button>
              </div>
              {measurements.length ? (
                <div className="record-grid">
                  {measurements.map((item) => {
                    const garmentLabel = categories.find((category) => category.garment_type === item.garment_type)?.name || [...GARMENTS.women, ...GARMENTS.men].find((garment) => garment.value === item.garment_type)?.label || item.garment_type
                    const entries = Object.entries(item.measurements || {})
                    return (
                      <article className="record-card" key={item.id}>
                        <div className="record-card-head">
                          <span className="record-icon"><Ruler size={20} /></span>
                          <div><h3>{item.profile_name}</h3><p>{garmentLabel} · {item.gender}</p></div>
                          <div className="record-actions">
                            <button aria-label={`Edit ${item.profile_name}`} className="icon-button" onClick={() => setMeasurementDialog(item)} type="button"><Edit3 size={16} /></button>
                            <button aria-label={`Delete ${item.profile_name}`} className="icon-button danger" onClick={() => removeMeasurement(item)} type="button"><Trash2 size={16} /></button>
                          </div>
                        </div>
                        <div className="measurement-summary">
                          {entries.slice(0, 4).map(([key, value]) => (
                            <span key={key}><small>{FIELD_LABELS[key] || key}</small><strong>{value} {item.unit === "inches" ? "in" : "cm"}</strong></span>
                          ))}
                          {!entries.length && <p className="muted-copy">No values added yet.</p>}
                        </div>
                        {entries.length > 4 && <p className="more-measurements">+{entries.length - 4} more measurements</p>}
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="inline-empty">
                  <span className="record-icon large"><Ruler size={28} /></span>
                  <h3>No measurements saved</h3>
                  <p>Create named profiles for different people or garments. We’ll show the right fields for each Indian outfit.</p>
                  <button className="button button-primary" onClick={() => setMeasurementDialog("new")} type="button"><Plus size={17} /> Add your first profile</button>
                </div>
              )}
            </>
          )}

          {section === "addresses" && (
            <>
              <div className="section-heading">
                <div><p className="section-kicker">Delivery book</p><h2>Saved addresses</h2><p>Choose where completed garments should be delivered.</p></div>
                <button className="button button-primary" onClick={() => setAddressDialog("new")} type="button"><Plus size={17} /> Add address</button>
              </div>
              {addresses.length ? (
                <div className="record-grid">
                  {addresses.map((item) => (
                    <article className="record-card address-card" key={item.id}>
                      <div className="record-card-head">
                        <span className="record-icon"><Home size={20} /></span>
                        <div>
                          <h3>{item.recipient_name} {item.is_default && <span className="default-badge"><Star size={12} fill="currentColor" /> Default</span>}</h3>
                          <p>{item.phone_number}</p>
                        </div>
                        <div className="record-actions">
                          <button aria-label="Edit address" className="icon-button" onClick={() => setAddressDialog(item)} type="button"><Edit3 size={16} /></button>
                          <button aria-label="Delete address" className="icon-button danger" onClick={() => removeAddress(item)} type="button"><Trash2 size={16} /></button>
                        </div>
                      </div>
                      <address>{item.street_address}<br />{item.city}, {item.state} {item.postal_code}<br />{item.country}</address>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="inline-empty">
                  <span className="record-icon large"><MapPin size={28} /></span>
                  <h3>No delivery addresses yet</h3>
                  <p>Save your first address now for a quicker checkout later.</p>
                  <button className="button button-primary" onClick={() => setAddressDialog("new")} type="button"><Plus size={17} /> Add an address</button>
                </div>
              )}
            </>
          )}

          {section === "activity" && (
            <>
              <div className="section-heading">
                <div><p className="section-kicker">Account history</p><h2>Activity log</h2><p>Read notifications and earlier account updates remain available here.</p></div>
              </div>
              {activityLoading && activities.length === 0 ? (
                <div className="inline-empty compact"><LoaderCircle className="spin" size={26} /><p>Loading activity...</p></div>
              ) : activities.length ? (
                <div className="activity-log">
                  {activities.map((item) => (
                    <article className={`activity-log-item ${item.read_at ? "is-read" : "is-unread"}`} key={item.id}>
                      <span className="activity-log-icon"><BellRing size={19} /></span>
                      <div className="activity-log-copy">
                        <div className="activity-log-title">
                          <strong>{item.title}</strong>
                          {!item.read_at && <span>New</span>}
                        </div>
                        <p>{item.message}</p>
                        <small>
                          {activityTime(item.created_at)}
                          {item.read_at ? ` | Read ${activityTime(item.read_at)}` : " | Unread"}
                        </small>
                      </div>
                      {(item.link || !item.read_at) && (
                        <button className="activity-log-action" onClick={() => openActivity(item)} type="button">
                          {item.link ? "Open" : "Mark read"} <ChevronRight size={15} />
                        </button>
                      )}
                    </article>
                  ))}
                  {activityHasMore && (
                    <button className="button button-secondary activity-load-more" disabled={activityLoading} onClick={loadMoreActivity} type="button">
                      {activityLoading ? <><LoaderCircle className="spin" size={16} /> Loading...</> : "Load older activity"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="inline-empty">
                  <span className="record-icon large"><History size={28} /></span>
                  <h3>No activity yet</h3>
                  <p>Account and order updates will appear here after they are created.</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {measurementDialog && (
        <Dialog
          description="Create a garment-specific profile using body measurements."
          onClose={() => setMeasurementDialog(null)}
          title={measurementDialog === "new" ? "Add measurement profile" : "Edit measurement profile"}
        >
          <MeasurementForm
            categories={categories}
            initial={measurementDialog === "new" ? undefined : measurementDialog}
            onCancel={() => setMeasurementDialog(null)}
            onSave={saveMeasurement}
          />
        </Dialog>
      )}
      {addressDialog && (
        <Dialog
          description="Where should we send your finished garments?"
          onClose={() => setAddressDialog(null)}
          title={addressDialog === "new" ? "Add delivery address" : "Edit delivery address"}
        >
          <AddressForm
            initial={addressDialog === "new" ? undefined : addressDialog}
            onCancel={() => setAddressDialog(null)}
            onSave={saveAddress}
          />
        </Dialog>
      )}
    </div>
  )
}

export default Profile
