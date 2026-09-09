import * as ImagePicker from "expo-image-picker"
import { type ReactNode, useEffect, useState } from "react"
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native"
import { Bell, Camera, ChevronRight, History, LogOut, MapPin, Menu, Moon, Pencil, Ruler, Store, UserRound, X } from "lucide-react-native"
import { useRouter } from "expo-router"
import { useSession } from "@/auth/SessionProvider"
import { absoluteUrl, api, currentAccessToken } from "@/lib/api"
import type { UserProfile } from "@/types/api"
import { AppButton, Field, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function ProfileScreen() {
  const router = useRouter()
  const { colors, preference, setPreference } = useTheme()
  const { profile, logout, reloadProfile } = useSession()
  const [name, setName] = useState(profile?.full_name || "")
  const [phone, setPhone] = useState(profile?.phone || "")
  const [location, setLocation] = useState(profile?.location || "")
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const resetFields = () => {
    setName(profile?.full_name || "")
    setPhone(profile?.phone || "")
    setLocation(profile?.location || "")
  }
  useEffect(resetFields, [profile])

  const save = async () => {
    setBusy(true); setError(""); setMessage("")
    try {
      await api<UserProfile>("/api/auth/me", { method: "PUT", body: JSON.stringify({ full_name: name.trim(), phone: phone.trim() || null, location: location.trim() || null }) })
      await reloadProfile()
      setEditing(false)
      setMessage("Profile updated")
    } catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }

  const choosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
    if (result.canceled) return
    const asset = result.assets[0]
    if (!asset.fileSize || asset.fileSize > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType || "")) return setError("Choose a JPEG, PNG, or WebP profile photo up to 5 MB.")
    setBusy(true); setError("")
    try {
      const data = new FormData()
      data.append("file", { uri: asset.uri, name: asset.fileName || `profile-${Date.now()}.jpg`, type: asset.mimeType || "image/jpeg" } as unknown as Blob)
      await api<UserProfile>("/api/media/profile-image", { method: "POST", body: data })
      await reloadProfile()
      setMessage("Profile photo updated")
    } catch (value) { setError((value as Error).message) } finally { setBusy(false) }
  }

  const openRoute = (path: "/profile/addresses" | "/profile/measurements" | "/profile/activity" | "/profile/become-vendor" | "/notifications") => {
    setMenuOpen(false)
    router.push(path as never)
  }
  const image = profile?.profile_image_url
  const action = <View style={styles.headerActions}>
    <Pressable accessibilityLabel={editing ? "Cancel editing" : "Edit profile"} onPress={() => { if (editing) resetFields(); setEditing((current) => !current); setError(""); setMessage("") }} style={[styles.headerButton, { borderColor: colors.border }]}>{editing ? <X color={colors.text} size={20} /> : <Pencil color={colors.text} size={19} />}</Pressable>
    <Pressable accessibilityLabel="Open profile menu" onPress={() => setMenuOpen(true)} style={[styles.headerButton, { borderColor: colors.border }]}><Menu color={colors.text} size={21} /></Pressable>
  </View>

  return <Screen>
    <PageHeader action={action} subtitle="Your account identity and preferences." title="Profile" />
    <View style={[styles.identity, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityLabel="Change profile photo" disabled={busy} onPress={() => void choosePhoto()} style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>{image ? <Image source={{ uri: absoluteUrl(image), headers: currentAccessToken() ? { Authorization: `Bearer ${currentAccessToken()}` } : undefined }} style={styles.avatarImage} /> : <UserRound color={colors.primary} size={32} />}<View style={[styles.camera, { backgroundColor: colors.primary }]}><Camera color={colors.white} size={13} /></View></Pressable>
      <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 22 }}>{profile?.full_name}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", marginTop: 3 }}>{profile?.email}</Text><View style={{ marginTop: 8 }}><Pill tone="primary">{profile?.role.replaceAll("_", " ")}</Pill></View></View>
    </View>
    <View style={[styles.details, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={{ color: colors.muted, fontFamily: "Manrope_600SemiBold", fontSize: 12, lineHeight: 18, marginBottom: 15 }}>{editing ? "Update the fields below, then save your changes." : "Your details are protected. Tap the pencil to edit them."}</Text>
      <Field editable={editing} label="Full name" maxLength={100} onChangeText={setName} value={name} />
      <Field editable={editing} keyboardType="phone-pad" label="Phone number" maxLength={20} onChangeText={setPhone} value={phone} />
      <Field editable={editing} label="Location" maxLength={150} onChangeText={setLocation} placeholder="City, State" value={location} />
      {!!error && <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text>}
      {!!message && <Text style={{ color: colors.success, fontFamily: "Manrope_600SemiBold", marginBottom: 12 }}>{message}</Text>}
      {editing && <AppButton disabled={busy || name.trim().length < 2} onPress={() => void save()}>{busy ? "Saving…" : "Save changes"}</AppButton>}
    </View>

    <Modal animationType="fade" onRequestClose={() => setMenuOpen(false)} transparent visible={menuOpen}>
      <Pressable onPress={() => setMenuOpen(false)} style={styles.backdrop}>
        <Pressable onPress={() => undefined} style={[styles.menuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.menuHeader}><View><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 24 }}>Profile menu</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", marginTop: 3 }}>Account tools in one place</Text></View><Pressable accessibilityLabel="Close menu" onPress={() => setMenuOpen(false)} style={[styles.headerButton, { borderColor: colors.border }]}><X color={colors.text} size={20} /></Pressable></View>
          <MenuItem icon={<MapPin color={colors.primary} size={20} />} label="Delivery addresses" onPress={() => openRoute("/profile/addresses")} />
          <MenuItem icon={<Ruler color={colors.primary} size={20} />} label="Measurements" onPress={() => openRoute("/profile/measurements")} />
          <MenuItem icon={<Bell color={colors.primary} size={20} />} label="Notifications" onPress={() => openRoute("/notifications")} />
          <MenuItem icon={<History color={colors.primary} size={20} />} label="Activity log" onPress={() => openRoute("/profile/activity")} />
          {profile?.role === "customer" && <MenuItem icon={<Store color={colors.primary} size={20} />} label={profile.vendor_request_status === "pending" ? "Vendor application" : "Become a vendor"} onPress={() => openRoute("/profile/become-vendor")} />}
          <MenuItem icon={<Moon color={colors.primary} size={20} />} label={`Theme: ${preference === "system" ? "Follow system" : preference}`} onPress={() => {
            Alert.alert("Appearance", "Choose a theme for this device.", (["system", "light", "dark"] as const).map((value) => ({
              text: value === "system" ? "Follow system" : value === "light" ? "Light" : "Dark",
              onPress: () => { void setPreference(value).catch(() => Alert.alert("Theme not saved", "Please try again.")) },
            })))
          }} />
          <MenuItem danger icon={<LogOut color={colors.danger} size={20} />} label="Sign out" onPress={() => { setMenuOpen(false); void logout() }} />
        </Pressable>
      </Pressable>
    </Modal>
  </Screen>
}

const MenuItem = ({ icon, label, onPress, danger = false }: { icon: ReactNode; label: string; onPress: () => void; danger?: boolean }) => {
  const { colors } = useTheme()
  return <Pressable onPress={onPress} style={[styles.menuItem, { borderColor: colors.border }]}>{icon}<Text style={{ color: danger ? colors.danger : colors.text, flex: 1, fontFamily: "Manrope_700Bold" }}>{label}</Text><ChevronRight color={colors.muted} size={18} /></Pressable>
}

const styles = StyleSheet.create({
  identity: { alignItems: "center", borderRadius: 19, borderWidth: 1, flexDirection: "row", gap: 13, marginBottom: 16, padding: 15 },
  avatar: { alignItems: "center", borderRadius: 18, height: 66, justifyContent: "center", width: 66 },
  avatarImage: { borderRadius: 18, height: "100%", width: "100%" },
  camera: { alignItems: "center", borderRadius: 99, bottom: -4, height: 24, justifyContent: "center", position: "absolute", right: -4, width: 24 },
  details: { borderRadius: 19, borderWidth: 1, padding: 16 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerButton: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  backdrop: { backgroundColor: "rgba(0,0,0,.55)", flex: 1, justifyContent: "flex-end", padding: 12 },
  menuSheet: { borderRadius: 24, borderWidth: 1, gap: 8, padding: 18, paddingBottom: 28 },
  menuHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  menuItem: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 56, paddingHorizontal: 4 },
})
