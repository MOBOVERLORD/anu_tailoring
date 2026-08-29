import { useState } from "react"
import { Text, View } from "react-native"
import { Store } from "lucide-react-native"
import { useSession } from "@/auth/SessionProvider"
import { api } from "@/lib/api"
import type { UserProfile } from "@/types/api"
import { AppButton, Field, Heading, PageHeader, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function BecomeVendorScreen() {
  const { colors } = useTheme()
  const { profile, reloadProfile } = useSession()
  const [shopName, setShopName] = useState(profile?.vendor_request_shop_name || "")
  const [message, setMessage] = useState(profile?.vendor_request_message || "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    setBusy(true); setError("")
    try {
      await api<UserProfile>("/api/vendors/request", { method: "POST", body: JSON.stringify({ shop_name: shopName.trim(), message: message.trim() || null }) })
      await reloadProfile()
    } catch (value) { setError((value as Error).message) }
    finally { setBusy(false) }
  }

  return <Screen>
    <PageHeader back subtitle="Apply from your account; administrators review every shop before vendor tools are enabled." title="Become a vendor" />
    <View style={{ alignItems: "center", backgroundColor: colors.primarySoft, borderRadius: 20, gap: 9, marginBottom: 20, padding: 20 }}><Store color={colors.primary} size={31} /><Heading size={23}>{profile?.vendor_request_status === "pending" ? "Application under review" : profile?.vendor_request_status === "rejected" ? "Update your application" : "Open your Vastrivo shop"}</Heading><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 21, textAlign: "center" }}>{profile?.vendor_request_status === "pending" ? "You’ll receive a notification after an administrator reviews your details." : "Tell us about your tailoring shop and the garments you specialise in."}</Text></View>
    {profile?.vendor_request_status === "rejected" && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 14 }}>{profile.vendor_request_review_comment || "Update the details requested by the reviewer and apply again."}</Text>}
    <Field editable={profile?.vendor_request_status !== "pending"} label="Proposed shop name" maxLength={150} onChangeText={setShopName} value={shopName} />
    <Field editable={profile?.vendor_request_status !== "pending"} label="About your tailoring service (optional)" maxLength={2000} multiline numberOfLines={6} onChangeText={setMessage} placeholder="Experience, garments, service area…" style={{ minHeight: 125, textAlignVertical: "top" }} value={message} />
    {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", marginBottom: 12 }}>{error}</Text>}
    {profile?.vendor_request_status !== "pending" && <AppButton disabled={busy || shopName.trim().length < 2} onPress={() => void submit()}>{busy ? "Submitting…" : profile?.vendor_request_status === "rejected" ? "Apply again" : "Request vendor access"}</AppButton>}
  </Screen>
}
