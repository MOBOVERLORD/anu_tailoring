import { useCallback, useState } from "react"
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { ClipboardList, PackageCheck, UserRound } from "lucide-react-native"
import { api } from "@/lib/api"
import type { Order, PaginatedOrders } from "@/types/api"
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

type OrderFilter = "all" | "active" | "delivered" | "cancelled"

const isActive = (order: Order) => !["delivered", "cancelled"].includes(order.status)

export default function StudioOrdersScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<OrderFilter>("active")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      const response = await api<PaginatedOrders>("/api/orders/vendor?limit=100&offset=0")
      setOrders(response.items)
      setTotal(response.total)
    } catch (value) {
      setError((value as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const counts = {
    active: orders.filter(isActive).length,
    all: total,
    cancelled: orders.filter((order) => order.status === "cancelled").length,
    delivered: orders.filter((order) => order.status === "delivered").length,
  }
  const visibleOrders = orders.filter((order) => filter === "all" || (filter === "active" ? isActive(order) : order.status === filter))
  const filters: Array<{ label: string; value: OrderFilter }> = [
    { label: "Active", value: "active" },
    { label: "All", value: "all" },
    { label: "Delivered", value: "delivered" },
    { label: "Cancelled", value: "cancelled" },
  ]

  return <Screen scroll={false}>
    <PageHeader back subtitle="Customer purchases, invoices and tailoring work for your shop." title="Customer orders" />
    {loading ? <LoadingState label="Loading customer orders…" /> : error && !orders.length ? <ErrorState message={error} retry={() => void load()} /> : <>
      {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", marginBottom: 10 }}>{error}</Text>}
      <ScrollView contentContainerStyle={styles.filters} horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        {filters.map((item) => <Pressable key={item.value} onPress={() => setFilter(item.value)} style={[styles.filter, { backgroundColor: filter === item.value ? colors.primary : colors.surface, borderColor: filter === item.value ? colors.primary : colors.border }]}><Text numberOfLines={1} style={[styles.filterText, { color: filter === item.value ? colors.white : colors.text }]}>{item.label} · {counts[item.value]}</Text></Pressable>)}
      </ScrollView>
      <FlatList contentContainerStyle={styles.list} data={visibleOrders} keyExtractor={(item) => String(item.id)} ListEmptyComponent={<EmptyState message={`No ${filter === "all" ? "customer" : filter} orders are available.`} title="No matching orders" />} refreshControl={<RefreshControl onRefresh={() => { setRefreshing(true); void load() }} refreshing={refreshing} tintColor={colors.primary} />} renderItem={({ item }) => <Pressable onPress={() => router.push({ pathname: "/order/[id]", params: { id: String(item.id) } })} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}><View style={[styles.icon, { backgroundColor: colors.primarySoft }]}><ClipboardList color={colors.primary} size={23} /></View><View style={styles.copy}><View style={styles.titleRow}><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 19 }}>Order #{item.id}</Text><Pill tone={item.status === "delivered" ? "success" : "primary"}>{item.status.replaceAll("_", " ")}</Pill></View><Text numberOfLines={1} style={{ color: colors.text, fontFamily: "Manrope_600SemiBold", fontSize: 12, marginTop: 4 }}><UserRound size={12} /> {item.customer.full_name}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 11, marginTop: 3 }}>{new Date(item.created_at).toLocaleDateString("en-IN")} · {item.order_items.length} design{item.order_items.length === 1 ? "" : "s"} · {item.product_items.length} product{item.product_items.length === 1 ? "" : "s"}</Text><View style={styles.total}><PackageCheck color={colors.muted} size={14} /><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold" }}>₹{item.total_amount.toLocaleString("en-IN")}</Text></View></View></Pressable>} />
    </>}
  </Screen>
}

const styles = StyleSheet.create({
  filterScroll: { flexGrow: 0, marginBottom: 13 },
  filters: { alignItems: "center", gap: 8, minHeight: 44, paddingRight: 4 },
  filter: { alignItems: "center", borderRadius: 99, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 13 },
  filterText: { fontFamily: "Manrope_700Bold", fontSize: 12, lineHeight: 18 },
  list: { gap: 11, paddingBottom: 34 },
  card: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  icon: { alignItems: "center", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  copy: { flex: 1, minWidth: 0 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  total: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 8 },
})
