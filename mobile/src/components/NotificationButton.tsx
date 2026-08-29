import { useCallback, useEffect, useState } from "react"
import { AppState, Pressable, StyleSheet, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Bell } from "lucide-react-native"
import { api } from "@/lib/api"
import type { NotificationList } from "@/types/api"
import { useTheme } from "@/theme/theme"

export const NotificationButton = () => {
  const router = useRouter()
  const { colors } = useTheme()
  const [unread, setUnread] = useState(0)
  const load = useCallback(async () => {
    try {
      const result = await api<NotificationList>("/api/notifications?unread_only=true&limit=1")
      setUnread(result.unread_count)
    } catch {
      // A notification badge must never block the current screen.
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void load() })
    return () => listener.remove()
  }, [load])

  return <Pressable
    accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ""}`}
    onPress={() => router.push("/notifications" as never)}
    style={({ pressed }) => [styles.button, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
  >
    <Bell color={colors.text} size={20} />
    {unread > 0 && <View style={[styles.badge, { backgroundColor: colors.primary }]}><Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
  </Pressable>
}

const styles = StyleSheet.create({
  button: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  badge: { alignItems: "center", borderRadius: 99, justifyContent: "center", minHeight: 17, minWidth: 17, paddingHorizontal: 3, position: "absolute", right: -5, top: -5 },
  badgeText: { color: "#FFFFFF", fontFamily: "Manrope_700Bold", fontSize: 9 },
})
