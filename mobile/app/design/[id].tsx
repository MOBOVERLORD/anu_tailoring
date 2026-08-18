import { useCallback, useEffect, useState } from "react"
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { Heart, Store } from "lucide-react-native"
import { absoluteUrl, api, currentAccessToken } from "@/lib/api"
import type { Design } from "@/types/api"
import { AppButton, ErrorState, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function DesignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { colors } = useTheme(); const [design, setDesign] = useState<Design | null>(null); const [liked, setLiked] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState("")
  const load = useCallback(async () => { setError(""); try { setDesign(await api<Design>(`/api/designs/${id}`)); const favorites = await api<Design[]>("/api/designs/liked/me"); setLiked(favorites.some((item) => String(item.id) === id)) } catch (value) { setError((value as Error).message) } finally { setLoading(false) } }, [id])
  useEffect(() => { void load() }, [load])
  if (loading) return <Screen scroll={false}><LoadingState label="Opening design…" /></Screen>
  if (error || !design) return <Screen><PageHeader back title="Design" /><ErrorState message={error || "Design not found"} retry={() => void load()} /></Screen>
  const images = design.images.filter((item) => item.url).length ? design.images.filter((item) => item.url).map((item) => item.url as string) : design.image_url ? [design.image_url] : []
  const toggle = async () => { const next = !liked; setLiked(next); try { await api(`/api/designs/${design.id}/like`, { method: next ? "POST" : "DELETE" }) } catch { setLiked(!next) } }
  return <Screen><PageHeader action={<Pressable accessibilityLabel="Toggle favorite design" onPress={() => void toggle()} style={[styles.favorite, { backgroundColor: colors.surface, borderColor: colors.border }]}><Heart color={liked ? colors.primary : colors.muted} fill={liked ? colors.primary : "none"} size={21} /></Pressable>} back title={design.title} /><ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }}>{images.length ? images.map((url) => <Image key={url} resizeMode="cover" source={{ uri: absoluteUrl(url), headers: currentAccessToken() ? { Authorization: `Bearer ${currentAccessToken()}` } : undefined }} style={styles.hero} />) : <View style={[styles.hero, { backgroundColor: colors.surfaceMuted }]} />}</ScrollView><View style={styles.pills}><Pill tone="primary">{design.category}</Pill><Pill>{design.garment_type}</Pill></View><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 27, marginTop: 16 }}>{design.title}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 23, marginTop: 9 }}>{design.description}</Text><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold", fontSize: 19, marginVertical: 20 }}>Tailoring from ₹{design.base_price.toLocaleString("en-IN")}</Text>{design.vendor_id && <AppButton onPress={() => router.push({ pathname: "/vendor/[id]", params: { id: String(design.vendor_id) } })} variant="secondary"><Store size={17} /> View {design.vendor_name || "vendor"}</AppButton>}</Screen>
}

const styles = StyleSheet.create({ favorite: { alignItems: "center", borderRadius: 14, borderWidth: 1, height: 44, justifyContent: "center", width: 44 }, hero: { height: 420, width: 390 }, pills: { flexDirection: "row", gap: 7, marginTop: 17 } })
