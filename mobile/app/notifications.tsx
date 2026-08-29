import { useCallback, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { Bell, CheckCheck } from "lucide-react-native"
import { api } from "@/lib/api"
import type { AppNotification, NotificationList } from "@/types/api"
import { AppButton, EmptyState, ErrorState, LoadingState, PageHeader, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function NotificationsScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    setError("")
    try { setItems((await api<NotificationList>("/api/notifications?unread_only=true&limit=50")).items) }
    catch (value) { setError((value as Error).message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const destination = (link: string | null) => {
    if (!link) return null
    if (link.includes("orders")) return "/(tabs)/orders"
    if (link.includes("profile")) return "/(tabs)/profile"
    return "/profile/activity"
  }
  const open = async (item: AppNotification) => {
    try {
      await api(`/api/notifications/${item.id}/read`, { method: "POST" })
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      const route = destination(item.link)
      if (route) router.push(route as never)
    } catch (value) { setError((value as Error).message) }
  }
  const readAll = async () => {
    try { await api("/api/notifications/read-all", { method: "POST" }); setItems([]) }
    catch (value) { setError((value as Error).message) }
  }

  if (loading) return <Screen scroll={false}><LoadingState label="Loading notifications…" /></Screen>
  return <Screen>
    <PageHeader action={items.length ? <View style={{ minWidth: 112 }}><AppButton onPress={() => void readAll()} variant="secondary"><CheckCheck color={colors.text} size={17} />Read all</AppButton></View> : undefined} back subtitle="Only unread updates appear here. Read items remain in Activity log." title="Notifications" />
    {!!error && !items.length && <ErrorState message={error} retry={() => void load()} />}
    {!!error && items.length > 0 && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", marginBottom: 12 }}>{error}</Text>}
    {items.length ? items.map((item) => <Pressable key={item.id} onPress={() => void open(item)} style={({ pressed }) => [styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.primary, opacity: pressed ? 0.75 : 1 }]}><View style={[styles.icon, { backgroundColor: colors.surface }]}><Bell color={colors.primary} size={19} /></View><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>{item.title}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 19, marginTop: 4 }}>{item.message}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_500Medium", fontSize: 10, marginTop: 7 }}>{new Date(item.created_at).toLocaleString("en-IN")}</Text></View><View style={[styles.unread, { backgroundColor: colors.primary }]} /></Pressable>) : !error && <EmptyState message="New order, payment, approval, and delivery updates will appear here." title="You’re all caught up" />}
  </Screen>
}

const styles = StyleSheet.create({
  card: { alignItems: "flex-start", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 10, padding: 14 },
  icon: { alignItems: "center", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  unread: { borderRadius: 99, height: 8, marginTop: 5, width: 8 },
})
