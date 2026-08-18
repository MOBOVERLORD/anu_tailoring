import { useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { Link } from "expo-router"
import { Scissors } from "lucide-react-native"
import { useSession } from "@/auth/SessionProvider"
import { AppButton, Field, Heading, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function LoginScreen() {
  const { colors } = useTheme()
  const { login } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    setBusy(true); setError("")
    try { await login(email.trim(), password) }
    catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }

  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}><Screen>
    <View style={styles.brand}><View style={[styles.logo, { backgroundColor: colors.primarySoft }]}><Scissors color={colors.primary} size={29} /></View><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold", fontSize: 18 }}>Vastrivo</Text></View>
    <View style={{ marginBottom: 28 }}><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.6 }}>WELCOME BACK</Text><Heading>Sign in to your account</Heading><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 22, marginTop: 8 }}>Your saved fits, orders, and favorite designs are waiting.</Text></View>
    <Field autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email address" onChangeText={setEmail} placeholder="you@example.com" value={email} />
    <Field autoCapitalize="none" autoComplete="current-password" label="Password" onChangeText={setPassword} placeholder="Your password" secureTextEntry value={password} />
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", marginBottom: 14 }}>{error}</Text>}
    <AppButton disabled={busy || !email.trim() || !password} onPress={submit}>{busy ? "Signing in…" : "Sign in"}</AppButton>
    <Link asChild href="/(auth)/forgot-password"><Pressable><Text style={[styles.link, { color: colors.primary }]}>Forgot password?</Text></Pressable></Link>
    <View style={styles.createRow}><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular" }}>New to Vastrivo?</Text><Link href="/(auth)/register" style={{ color: colors.primary, fontFamily: "Manrope_700Bold" }}> Create account</Link></View>
  </Screen></KeyboardAvoidingView>
}

const styles = StyleSheet.create({ brand: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 54, marginTop: 12 }, logo: { alignItems: "center", borderRadius: 14, height: 50, justifyContent: "center", width: 50 }, link: { fontFamily: "Manrope_700Bold", marginTop: 19, textAlign: "center" }, createRow: { flexDirection: "row", justifyContent: "center", marginTop: 36 } })
