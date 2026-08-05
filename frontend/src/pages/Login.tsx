import { useState } from "react"
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Ruler, Scissors, Sparkles } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { api, getAccessToken, setSession } from "@/lib/api"

interface TokenResponse {
  access_token: string
}

const Login = () => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  if (getAccessToken()) return <Navigate replace to="/" />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const data = await api<TokenResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      setSession(data.access_token)
      toast.success("Welcome back")
      navigate("/")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Anu Tailoring">
        <div className="story-text">
          <p className="eyebrow light"><Sparkles size={15} /> Your fit, remembered</p>
          <h1>Clothes designed around <em>you.</em></h1>
          <p>Save every measurement, delivery detail, and design you love in one beautifully simple place.</p>
        </div>
        <div className="story-visual" aria-hidden="true">
          <div className="pattern-ring ring-one" />
          <div className="pattern-ring ring-two" />
          <div className="story-icon icon-scissors"><Scissors /></div>
          <div className="story-icon icon-ruler"><Ruler /></div>
          <div className="story-thread" />
        </div>
        <div className="story-proof">
          <div className="proof-avatars">
            <span>AK</span><span>MS</span><span>RP</span>
          </div>
          <p><strong>Made personally.</strong><br />Remembered for next time.</p>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="auth-lock"><LockKeyhole size={21} /></span>
            <p className="eyebrow">Welcome back</p>
            <h2>Sign in to your account</h2>
            <p>Your saved fits and favorite designs are waiting.</p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  autoComplete="email"
                  id="email"
                  maxLength={254}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
            </div>
            <div className="field">
              <div className="label-row">
                <label htmlFor="password">Password</label>
              </div>
              <div className="input-with-icon">
                <LockKeyhole size={18} />
                <input
                  autoComplete="current-password"
                  id="password"
                  maxLength={512}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={`${showPassword ? "Hide" : "Show"} password`}
                  className="password-toggle"
                  onClick={() => setShowPassword((shown) => !shown)}
                  type="button"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button className="button button-primary button-wide" disabled={submitting} type="submit">
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting && <ArrowRight size={18} />}
            </button>
          </form>
          <p className="auth-switch">
            New to Anu Tailoring? <Link to="/register">Create an account</Link>
          </p>
          <div className="secure-note"><LockKeyhole size={14} /> Your account details stay private.</div>
        </div>
      </section>
    </div>
  )
}

export default Login
