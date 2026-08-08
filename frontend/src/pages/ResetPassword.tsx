import { useState } from "react"
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import toast from "react-hot-toast"
import { api, clearSession } from "@/lib/api"

const ResetPassword = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") || ""
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  const passwordChecks = {
    length: password.length >= 8,
    letter: /[A-Za-z]/.test(password),
    number: /\d/.test(password),
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== confirmation) {
      toast.error("Passwords don’t match")
      return
    }
    setSubmitting(true)
    try {
      await api<{ message: string }>("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      })
      clearSession()
      setComplete(true)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="simple-auth-page">
      <div className="simple-auth-card auth-recovery-card">
        <Link className="back-link" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>
        <span className="auth-lock"><KeyRound size={21} /></span>
        <p className="eyebrow">Secure password reset</p>
        <h1>{complete ? "Password updated" : "Choose a new password"}</h1>
        {complete ? (
          <>
            <p>Your password has been changed and every existing session has been closed.</p>
            <Link className="button button-primary button-wide" to="/login">Sign in securely <ArrowRight size={18} /></Link>
          </>
        ) : !token ? (
          <>
            <p>This reset link is incomplete. Request a fresh link to continue.</p>
            <Link className="button button-primary button-wide" to="/forgot-password">Request a new link</Link>
          </>
        ) : (
          <>
            <p>Use at least eight characters with a letter and a number.</p>
            <form className="form-stack" onSubmit={submit}>
              <div className="field">
                <label htmlFor="new-password">New password</label>
                <div className="input-with-icon password-entry">
                  <input autoComplete="new-password" id="new-password" maxLength={128} minLength={8} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={password} />
                  <button aria-label={`${showPassword ? "Hide" : "Show"} password`} className="password-toggle" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </div>
                <div aria-label="Password requirements" aria-live="polite" className="password-requirements">
                  <span className={passwordChecks.length ? "is-valid" : ""}><Check size={12} /> 8+ characters</span>
                  <span className={passwordChecks.letter ? "is-valid" : ""}><Check size={12} /> Letter</span>
                  <span className={passwordChecks.number ? "is-valid" : ""}><Check size={12} /> Number</span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="confirm-reset-password">Confirm new password</label>
                <input aria-invalid={Boolean(confirmation && password !== confirmation)} autoComplete="new-password" id="confirm-reset-password" maxLength={128} onChange={(event) => setConfirmation(event.target.value)} required type={showPassword ? "text" : "password"} value={confirmation} />
                {confirmation && <small className={password === confirmation ? "field-success" : "field-error"}>{password === confirmation ? "Passwords match" : "Passwords do not match"}</small>}
              </div>
              <button className="button button-primary button-wide" disabled={submitting} type="submit">
                {submitting ? "Updating password…" : "Update password"} {!submitting && <ArrowRight size={18} />}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default ResetPassword
