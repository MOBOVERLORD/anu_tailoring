import { useState } from "react"
import { KeyboardAvoidingView, Platform, Text } from "react-native"
import { Link } from "expo-router"
import { useSession } from "@/auth/SessionProvider"
import { AppButton, Field, PageHeader, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function RegisterScreen() {
  const { colors } = useTheme(); const { register } = useSession()
  const [fullName, setFullName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("")
  const submit = async () => {
    if (password !== confirm) return setError("Passwords do not match")
    setBusy(true); setError("")
    try { await register({ full_name: fullName.trim(), email: email.trim(), phone: phone.trim(), password }) }
    catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }
  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}><Screen>
    <PageHeader subtitle="Create a customer account. Vendor access can be requested from your profile." title="Join Vastrivo" />
    <Field autoCapitalize="words" label="Full name" maxLength={100} onChangeText={setFullName} value={fullName} />
    <Field autoCapitalize="none" keyboardType="email-address" label="Email address" maxLength={254} onChangeText={setEmail} value={email} />
    <Field keyboardType="phone-pad" label="Phone number" maxLength={20} onChangeText={setPhone} value={phone} />
    <Field label="Password" maxLength={128} onChangeText={setPassword} secureTextEntry value={password} />
    <Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 12, marginBottom: 14, marginTop: -10 }}>At least 8 characters with a letter and number.</Text>
    <Field label="Confirm password" maxLength={128} onChangeText={setConfirm} secureTextEntry value={confirm} />
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", marginBottom: 14 }}>{error}</Text>}
    <AppButton disabled={busy || !fullName || !email || !phone || !password || !confirm} onPress={submit}>{busy ? "Creating account…" : "Create account"}</AppButton>
    <Link href="/(auth)/login" style={{ color: colors.primary, fontFamily: "Manrope_700Bold", marginTop: 22, textAlign: "center" }}>Back to sign in</Link>
  </Screen></KeyboardAvoidingView>
}
