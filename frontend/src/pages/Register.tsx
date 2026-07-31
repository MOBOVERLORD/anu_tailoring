import { useState } from "react"
import { ArrowLeft, ArrowRight, Mail, Phone, UserRound } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { api } from "@/lib/api"

const Register = () => {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
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
        <p className="eyebrow">Join Anu Tailoring</p>
        <h1>Create your account</h1>
        <p>Start saving designs and keep every family member’s perfect fit in one place.</p>
        <form autoComplete="off" className="form-stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <div className="input-with-icon"><UserRound size={18} />
              <input autoComplete="name" id="name" name="full_name" onChange={(e) => update("full_name", e.target.value)} required value={form.full_name} />
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="register-email">Email</label>
              <div className="input-with-icon"><Mail size={18} />
                <input autoComplete="off" id="register-email" name="registration_email" onChange={(e) => update("email", e.target.value)} required type="email" value={form.email} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="register-phone">Phone</label>
              <div className="input-with-icon"><Phone size={18} />
                <input autoComplete="tel" id="register-phone" name="phone" onChange={(e) => update("phone", e.target.value)} required type="tel" value={form.phone} />
              </div>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="register-password">Password</label>
              <input autoComplete="new-password" id="register-password" minLength={8} name="new_password" onChange={(e) => update("password", e.target.value)} required type="password" value={form.password} />
              <small>At least 8 characters, with a letter and number.</small>
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm password</label>
              <input autoComplete="new-password" id="confirm-password" name="confirm_new_password" onChange={(e) => update("confirmPassword", e.target.value)} required type="password" value={form.confirmPassword} />
            </div>
          </div>
          <button className="button button-primary button-wide" disabled={submitting} type="submit">
            {submitting ? "Creating account…" : "Create account"} <ArrowRight size={18} />
          </button>
        </form>
        <p className="vendor-contact">
          Are you a tailoring vendor? Vendor accounts are reviewed separately. Reach us at{" "}
          <a href="mailto:vendors@anutailoring.com">vendors@anutailoring.com</a>.
        </p>
      </div>
    </div>
  )
}

export default Register
