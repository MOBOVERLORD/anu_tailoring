import { useState } from "react"
import { ArrowLeft, ArrowRight, KeyRound, Mail } from "lucide-react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"
import { api } from "@/lib/api"

const ForgotPassword = () => {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [requested, setRequested] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await api<{ message: string }>("/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
      setRequested(true)
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
        <p className="eyebrow">Account recovery</p>
        <h1>{requested ? "Check your email" : "Reset your password"}</h1>
        {requested ? (
          <>
            <p>If an active account exists for <strong>{email}</strong>, we sent a secure reset link. It expires shortly.</p>
            <div className="recovery-note">For your security, the message may take a minute to arrive. Check spam before requesting another link.</div>
            <Link className="button button-primary button-wide" to="/login">Return to sign in <ArrowRight size={18} /></Link>
          </>
        ) : (
          <>
            <p>Enter the email used for your account and we’ll send you a one-time link.</p>
            <form className="form-stack" onSubmit={submit}>
              <div className="field">
                <label htmlFor="recovery-email">Email address</label>
                <div className="input-with-icon"><Mail size={18} />
                  <input autoComplete="email" id="recovery-email" maxLength={254} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
                </div>
              </div>
              <button className="button button-primary button-wide" disabled={submitting} type="submit">
                {submitting ? "Sending link…" : "Send reset link"} {!submitting && <ArrowRight size={18} />}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default ForgotPassword
