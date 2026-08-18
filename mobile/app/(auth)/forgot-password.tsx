import { useState } from "react"
import { Text } from "react-native"
import { api } from "@/lib/api"
import { AppButton, Field, PageHeader, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function ForgotPasswordScreen() {
  const { colors } = useTheme(); const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("")
  const submit = async () => { setBusy(true); setError(""); try { await api("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: email.trim() }) }); setMessage("If that email is registered, password-reset instructions have been sent.") } catch (value) { setError((value as Error).message) } finally { setBusy(false) } }
  return <Screen><PageHeader back subtitle="We will send a secure, short-lived reset link to your registered email." title="Reset password" /><Field autoCapitalize="none" keyboardType="email-address" label="Email address" onChangeText={setEmail} value={email} />{!!error && <Text style={{ color: colors.danger, marginBottom: 14 }}>{error}</Text>}{!!message && <Text style={{ color: colors.success, fontFamily: "Manrope_600SemiBold", lineHeight: 21, marginBottom: 14 }}>{message}</Text>}<AppButton disabled={busy || !email.trim()} onPress={submit}>{busy ? "Sending…" : "Send reset link"}</AppButton></Screen>
}
