import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Mail, Phone, UserRound } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { api } from "@/lib/api"

const Register = () => {
  const [vendorContactEmail, setVendorContactEmail] = useState("")
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api<{ vendor_contact_email: string }>("/api/public/config")
      .then((config) => setVendorContactEmail(config.vendor_contact_email))
      .catch(() => setVendorContactEmail(""))
  }, [])

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const passwordChecks = {
    length: form.password.length >= 8,
    letter: /[A-Za-z]/.test(form.password),
    number: /\d/.test(form.password),
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords don’t match")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      })
      toast.success("Account created — you can sign in now")
      navigate("/login")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="simple-auth-page">
      <div className="simple-auth-card">
        <Link className="back-link" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>
        <p className="eyebrow">Join Vastrivo</p>
        <h1>Create your account</h1>
        <p>Start saving designs and keep every family member’s perfect fit in one place.</p>
        <form autoComplete="off" className="form-stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <div className="input-with-icon"><UserRound size={18} />
              <input autoComplete="name" id="name" maxLength={100} name="full_name" onChange={(e) => update("full_name", e.target.value)} required value={form.full_name} />
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="register-email">Email</label>
              <div className="input-with-icon"><Mail size={18} />
                <input autoComplete="off" id="register-email" maxLength={254} name="registration_email" onChange={(e) => update("email", e.target.value)} required type="email" value={form.email} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="register-phone">Phone</label>
              <div className="input-with-icon"><Phone size={18} />
                <input autoComplete="tel" id="register-phone" maxLength={20} name="phone" onChange={(e) => update("phone", e.target.value)} required type="tel" value={form.phone} />
              </div>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="register-password">Password</label>
              <div className="input-with-icon password-entry">
                <input autoComplete="new-password" id="register-password" maxLength={128} minLength={8} name="new_password" onChange={(e) => update("password", e.target.value)} required type={showPassword ? "text" : "password"} value={form.password} />
                <button aria-label={`${showPassword ? "Hide" : "Show"} password`} className="password-toggle" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              <div aria-label="Password requirements" aria-live="polite" className="password-requirements">
                <span className={passwordChecks.length ? "is-valid" : ""}><Check size={12} /> 8+ characters</span>
                <span className={passwordChecks.letter ? "is-valid" : ""}><Check size={12} /> Letter</span>
                <span className={passwordChecks.number ? "is-valid" : ""}><Check size={12} /> Number</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm password</label>
              <div className="input-with-icon password-entry">
                <input aria-invalid={Boolean(form.confirmPassword && form.password !== form.confirmPassword)} autoComplete="new-password" id="confirm-password" maxLength={128} name="confirm_new_password" onChange={(e) => update("confirmPassword", e.target.value)} required type={showConfirmation ? "text" : "password"} value={form.confirmPassword} />
                <button aria-label={`${showConfirmation ? "Hide" : "Show"} password confirmation`} className="password-toggle" onClick={() => setShowConfirmation((value) => !value)} type="button">{showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              {form.confirmPassword && <small className={form.password === form.confirmPassword ? "field-success" : "field-error"}>{form.password === form.confirmPassword ? "Passwords match" : "Passwords do not match"}</small>}
            </div>
          </div>
          <button className="button button-primary button-wide" disabled={submitting} type="submit">
            {submitting ? "Creating account…" : "Create account"} <ArrowRight size={18} />
          </button>
        </form>
        <p className="vendor-contact">
          Are you a tailoring vendor? Vendor accounts are reviewed separately.
          {vendorContactEmail && <> Contact support at{" "}<a href={`mailto:${vendorContactEmail}`}>{vendorContactEmail}</a>.</>}
        </p>
      </div>
    </div>
  )
}

export default Register
