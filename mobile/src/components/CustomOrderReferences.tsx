import { useEffect, useState } from "react"
import * as ImagePicker from "expo-image-picker"
import { Image, Pressable, Text, View } from "react-native"
import { api, absoluteUrl, currentAccessToken } from "@/lib/api"
import { AppButton } from "@/components/ui"
import { useTheme } from "@/theme/theme"
import type { Design } from "@/types/api"

export function CustomOrderReferences({ vendorId, designs, photos, onDesigns, onPhotos, onBusy }: {
  vendorId: number; designs: number[]; photos: string[]; onDesigns: (ids: number[]) => void; onPhotos: (ids: string[]) => void; onBusy: (busy: boolean) => void
}) {
  const { colors } = useTheme()
  const [catalog, setCatalog] = useState<Design[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setError("")
    api<Design[]>(`/api/designs?vendor_id=${vendorId}`).then((items) => { if (current) setCatalog(items) }).catch((reason: Error) => { if (current) setError(reason.message) })
    return () => { current = false }
  }, [vendorId, retry])
  async function upload() {
    if (busy || photos.length >= 5) return
    setBusy(true); onBusy(true); setError("")
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 })
      if (result.canceled) return
      const file = result.assets[0]
      if (!file.fileSize || file.fileSize > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.mimeType || "")) throw new Error("Choose JPEG, PNG or WebP up to 5 MB.")
      const body = new FormData()
      body.append("file", { uri: file.uri, type: file.mimeType, name: file.fileName || "reference.jpg" } as unknown as Blob)
      const uploaded = await api<{ id: string }>("/api/order-reference-photos", { method: "POST", body })
      onPhotos([...photos, uploaded.id])
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false); onBusy(false) }
  }
  return <View style={{ gap: 12, marginBottom: 20 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>Design references (optional)</Text><Text style={{ color: colors.muted }}>Up to 5 vendor designs and 5 photos. Style references only; the chosen measurement profile applies to this request.</Text>
    {catalog.map((design) => <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: designs.includes(design.id) }} key={design.id} disabled={busy || (!designs.includes(design.id) && designs.length >= 5)} onPress={() => onDesigns(designs.includes(design.id) ? designs.filter((id) => id !== design.id) : [...designs, design.id])} style={{ padding: 14, borderWidth: 1, borderRadius: 12, borderColor: designs.includes(design.id) ? colors.primary : colors.border }}><Text style={{ color: colors.text }}>{designs.includes(design.id) ? "✓ " : ""}{design.title}</Text></Pressable>)}
    {!!error && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><AppButton onPress={() => setRetry((v) => v + 1)} variant="secondary">Retry design list</AppButton></>}
    <AppButton disabled={busy || photos.length >= 5} onPress={() => void upload()} variant="secondary">{busy ? "Uploading…" : `Add reference photo (${photos.length}/5)`}</AppButton>
    {photos.map((id) => <View key={id} style={{ gap: 8 }}><Image source={{ uri: absoluteUrl(`/api/order-reference-photos/${id}`), headers: { Authorization: `Bearer ${currentAccessToken()}` } }} style={{ width: 110, height: 110, borderRadius: 10 }} /><AppButton disabled={busy} onPress={() => onPhotos(photos.filter((photo) => photo !== id))} variant="secondary">Remove photo</AppButton></View>)}
  </View>
}
