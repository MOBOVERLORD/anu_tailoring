import { useCallback, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Bell, CheckCheck } from "lucide-react-native"
import { api } from "@/lib/api"
import type { AppNotification, NotificationList } from "@/types/api"
import { AppButton, EmptyState, ErrorState, LoadingState, PageHeader, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function ActivityScreen() {
  const { colors } = useTheme()
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const load = useCallback(async () => { setError(""); try { const result = await api<NotificationList>("/api/notifications?limit=100&offset=0"); setItems(result.items); setUnread(result.unread_count) } catch (value) { setError((value as Error).message) } finally { setLoading(false) } }, [])
  useEffect(() => { void load() }, [load])
  const read = async (item: AppNotification) => { if (item.read_at) return; try { const updated = await api<AppNotification>(`/api/notifications/${item.id}/read`, { method: "POST" }); setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry)); setUnread((current) => Math.max(0, current - 1)) } catch (value) { setError((value as Error).message) } }
  const readAll = async () => { try { await api("/api/notifications/read-all", { method: "POST" }); await load() } catch (value) { setError((value as Error).message) } }
  if (loading) return <Screen scroll={false}><LoadingState label="Loading activity…" /></Screen>
  if (error && !items.length) return <Screen><PageHeader back title="Activity log" /><ErrorState message={error} retry={() => void load()} /></Screen>
  return <Screen>
    <PageHeader action={unread ? <View style={{ minWidth: 104 }}><AppButton onPress={() => void readAll()} variant="secondary"><CheckCheck color={colors.text} size={17} />Read all</AppButton></View> : undefined} back subtitle="Read notifications and earlier account updates." title="Activity log" />
    {!!error && <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text>}
    {items.length ? <View>{items.map((item) => <Pressable key={item.id} onPress={() => void read(item)} style={[styles.card, { backgroundColor: item.read_at ? colors.surface : colors.primarySoft, borderColor: item.read_at ? colors.border : colors.primary }]}><View style={[styles.icon, { backgroundColor: colors.surface }]}><Bell color={item.read_at ? colors.muted : colors.primary} size={19} /></View><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>{item.title}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 19, marginTop: 4 }}>{item.message}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_500Medium", fontSize: 10, marginTop: 7 }}>{new Date(item.created_at).toLocaleString("en-IN")}</Text></View>{!item.read_at && <View style={[styles.unread, { backgroundColor: colors.primary }]} />}</Pressable>)}</View> : <EmptyState message="Order, approval, payment, and delivery updates will remain available here." title="No activity yet" />}
  </Screen>
}

const styles = StyleSheet.create({
  card: { alignItems: "flex-start", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 10, padding: 14 },
  icon: { alignItems: "center", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  unread: { borderRadius: 99, height: 8, marginTop: 5, width: 8 },
})
