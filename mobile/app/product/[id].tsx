import { useCallback, useEffect, useState } from "react"
import { Image, StyleSheet, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { Store } from "lucide-react-native"
import { absoluteUrl, api, currentAccessToken } from "@/lib/api"
import type { Product } from "@/types/api"
import { AppButton, ErrorState, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { colors } = useTheme(); const [product, setProduct] = useState<Product | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("")
  const load = useCallback(async () => { try { setProduct(await api<Product>(`/api/products/${id}`)) } catch (value) { setError((value as Error).message) } finally { setLoading(false) } }, [id])
  useEffect(() => { void load() }, [load])
  if (loading) return <Screen scroll={false}><LoadingState label="Opening product…" /></Screen>
  if (error || !product) return <Screen><PageHeader back title="Product" /><ErrorState message={error || "Product not found"} /></Screen>
  return <Screen><PageHeader back title={product.title} />{product.image_url ? <Image resizeMode="cover" source={{ uri: absoluteUrl(product.image_url), headers: currentAccessToken() ? { Authorization: `Bearer ${currentAccessToken()}` } : undefined }} style={[styles.image, { backgroundColor: colors.surfaceMuted }]} /> : <View style={[styles.image, { backgroundColor: colors.surfaceMuted }]} />}<View style={styles.pills}><Pill tone="primary">{product.category}</Pill><Pill>{product.unit}</Pill><Pill tone={product.stock_quantity > 0 ? "success" : "default"}>{product.stock_quantity > 0 ? "in stock" : "sold out"}</Pill></View><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 28, marginTop: 15 }}>{product.title}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 23, marginTop: 8 }}>{product.description}</Text><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold", fontSize: 21, marginVertical: 20 }}>₹{product.price.toLocaleString("en-IN")} / {product.unit}</Text>{product.sizes.length > 0 && <Text style={{ color: colors.text, fontFamily: "Manrope_600SemiBold", marginBottom: 14 }}>Sizes: {product.sizes.join(", ")}</Text>}<AppButton onPress={() => router.push({ pathname: "/vendor/[id]", params: { id: String(product.vendor_id) } })} variant="secondary"><Store size={17} /> View {product.vendor_name}</AppButton><View style={[styles.notice, { backgroundColor: colors.primarySoft }]}><Text style={{ color: colors.primary, fontFamily: "Manrope_600SemiBold", lineHeight: 20 }}>Native product cart and delivery checkout will be enabled in the next preview. Product purchasing remains available on vastrivo.in meanwhile.</Text></View></Screen>
}

const styles = StyleSheet.create({ image: { borderRadius: 22, height: 430, width: "100%" }, pills: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 16 }, notice: { borderRadius: 15, marginTop: 20, padding: 14 } })
