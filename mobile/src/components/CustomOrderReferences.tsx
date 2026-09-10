import { useEffect, useState } from "react"
import * as ImagePicker from "expo-image-picker"
import { Image, Pressable, ScrollView, Text, View } from "react-native"
import { api, absoluteUrl, currentAccessToken } from "@/lib/api"
import { AppButton } from "@/components/ui"
import { useTheme } from "@/theme/theme"
import type { Design } from "@/types/api"

export function CustomOrderReferences({ vendorId, designs, photos, onDesigns, onPhotos, onBusy, single = false, onCatalog }: {
  single?: boolean; onCatalog?: (items: Design[]) => void
  vendorId: number; designs: number[]; photos: string[]; onDesigns: (ids: number[]) => void; onPhotos: (ids: string[]) => void; onBusy: (busy: boolean) => void
}) {
  const { colors } = useTheme()
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalog, setCatalog] = useState<Design[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setError("")
    api<Design[]>(`/api/designs?vendor_id=${vendorId}`).then((items) => { if (current) { setCatalog(items); onCatalog?.(items) } }).catch((reason: Error) => { if (current) setError(reason.message) })
    return () => { current = false }
  }, [vendorId, retry, onCatalog])
  async function upload() {
    if (busy || photos.length >= (single ? 1 : 5)) return
    setBusy(true); onBusy(true); setError("")
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 })
      if (result.canceled) return
      const file = result.assets[0]
      if (!file.fileSize || file.fileSize > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.mimeType || "")) throw new Error("Choose JPEG, PNG or WebP up to 5 MB.")
      const body = new FormData()
      body.append("file", { uri: file.uri, type: file.mimeType, name: file.fileName || "reference.jpg" } as unknown as Blob)
      const uploaded = await api<{ id: string }>("/api/order-reference-photos", { method: "POST", body })
      if (single) onDesigns([])
      onPhotos([...photos, uploaded.id])
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false); onBusy(false) }
  }
  const image = (url: string) => ({ uri: absoluteUrl(url), headers: { Authorization: `Bearer ${currentAccessToken()}` } })
  const selected = catalog.find((item) => item.id === designs[0])
  return <View style={{ gap: 10 }}><Text style={{ color: colors.text }}>Design (optional)</Text>
    {single && selected && <View style={{ gap: 8 }}>{(selected.thumbnail_url || selected.image_url) && <Image source={image((selected.thumbnail_url || selected.image_url)!)} style={{ width: 80, height: 90 }} resizeMode="contain" />}<Text style={{ color: colors.text }}>{selected.title}</Text><AppButton variant="secondary" disabled={busy} onPress={() => { onDesigns([]); setShowCatalog(true) }}>Change design</AppButton></View>}
    {(!single || !designs.length && !photos.length) && <><AppButton variant="secondary" disabled={busy} onPress={() => setShowCatalog(!showCatalog)}>Choose vendor design</AppButton>
      {showCatalog && <ScrollView nestedScrollEnabled style={{ maxHeight: 300 }}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{catalog.filter((item) => !item.is_custom_request_template).map((item) => <Pressable accessibilityRole="button" accessibilityLabel={`Select ${item.title}`} key={item.id} disabled={busy || (!single && !designs.includes(item.id) && designs.length >= 5)} onPress={() => { onDesigns(single ? [item.id] : designs.includes(item.id) ? designs.filter((id) => id !== item.id) : [...designs, item.id]); if (single) setShowCatalog(false) }} style={{ width: "47%", padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>{(item.thumbnail_url || item.image_url) && <Image source={image((item.thumbnail_url || item.image_url)!)} style={{ width: "100%", height: 110 }} resizeMode="contain" />}<Text style={{ color: colors.text }}>{designs.includes(item.id) ? "✓ " : ""}{item.title}</Text></Pressable>)}</View>{!catalog.length && <Text style={{ color: colors.muted }}>No designs loaded. Try a photo instead.</Text>}</ScrollView>}
      <AppButton disabled={busy || photos.length >= (single ? 1 : 5)} onPress={() => void upload()} variant="secondary">{busy ? "Uploading…" : "Upload design photo"}</AppButton><Text style={{ color: colors.muted, fontSize: 12 }}>JPEG, PNG or WebP · up to 5 MB</Text></>}
    {!!error && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><AppButton onPress={() => setRetry((v) => v + 1)} variant="secondary">Retry design list</AppButton></>}
    {photos.map((id) => <View key={id} style={{ gap: 8 }}><Image source={image(`/api/order-reference-photos/${id}`)} style={{ width: 110, height: 110, borderRadius: 10 }} /><AppButton disabled={busy} onPress={() => onPhotos(photos.filter((photo) => photo !== id))} variant="secondary">Remove photo</AppButton></View>)}
  </View>
}
