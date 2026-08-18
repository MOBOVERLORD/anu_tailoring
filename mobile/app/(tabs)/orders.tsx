import { useCallback, useEffect, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { PackageCheck } from "lucide-react-native"
import { useSession } from "@/auth/SessionProvider"
import { api } from "@/lib/api"
import type { Order, PaginatedOrders } from "@/types/api"
import { EmptyState, ErrorState, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function OrdersScreen() {
  const { colors } = useTheme(); const { profile } = useSession(); const router = useRouter(); const [items, setItems] = useState<Order[]>([]); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState("")
  const load = useCallback(async () => { if (!profile || ["admin", "super_admin", "delivery_agent"].includes(profile.role)) { setLoading(false); return } setError(""); try { setItems((await api<PaginatedOrders>("/api/orders?limit=30&offset=0")).items) } catch (value) { setError((value as Error).message) } finally { setLoading(false); setRefreshing(false) } }, [profile])
  useEffect(() => { void load() }, [load])
  return <Screen scroll={false}><PageHeader subtitle="Purchases you placed as a customer, including purchases made from a vendor account." title="My orders" />{loading ? <LoadingState label="Loading orders…" /> : error ? <ErrorState message={error} retry={() => void load()} /> : ["admin", "super_admin", "delivery_agent"].includes(profile?.role || "") ? <EmptyState message="Administration remains available on the Vastrivo web workspace for the first mobile release." title="Web-first workspace" /> : <FlatList contentContainerStyle={{ gap: 12, paddingBottom: 30 }} data={items} keyExtractor={(item) => String(item.id)} ListEmptyComponent={<EmptyState message="Your tailoring and shop purchases will appear here." title="No orders yet" />} refreshControl={<RefreshControl onRefresh={() => { setRefreshing(true); void load() }} refreshing={refreshing} tintColor={colors.primary} />} renderItem={({ item }) => <Pressable onPress={() => router.push({ pathname: "/order/[id]", params: { id: String(item.id) } })} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}><View style={[styles.icon, { backgroundColor: colors.primarySoft }]}><PackageCheck color={colors.primary} size={24} /></View><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 20 }}>Order #{item.id}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 12, marginTop: 4 }}>{new Date(item.created_at).toLocaleDateString("en-IN")} · {item.order_items.length} tailoring item{item.order_items.length === 1 ? "" : "s"}</Text></View><View style={{ alignItems: "flex-end", gap: 8 }}><Pill tone={item.status === "delivered" ? "success" : "primary"}>{item.status.replaceAll("_", " ")}</Pill><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold" }}>₹{item.total_amount.toLocaleString("en-IN")}</Text></View></Pressable>} />}</Screen>
}

const styles = StyleSheet.create({ card: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 }, icon: { alignItems: "center", borderRadius: 14, height: 48, justifyContent: "center", width: 48 } })
