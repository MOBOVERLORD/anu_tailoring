import * as ImagePicker from "expo-image-picker"
import { useCallback, useEffect, useState } from "react"
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Camera, Edit3, ImagePlus, Plus, Send, Trash2, X } from "lucide-react-native"
import { absoluteUrl, api, currentAccessToken } from "@/lib/api"
import type { Design } from "@/types/api"
import { AppButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const categories = ["women", "men", "unisex", "kids"] as const
type Category = typeof categories[number]
type ListingFilter = "all" | Design["status"]

interface DraftForm {
  title: string
  description: string
  category: Category
  garment_type: string
  base_price: string
}

const emptyForm: DraftForm = { title: "", description: "", category: "women", garment_type: "", base_price: "" }

const DesignForm = ({ design, onClose, onSaved }: { design: Design | null; onClose: () => void; onSaved: () => Promise<void> }) => {
  const { colors } = useTheme()
  const [form, setForm] = useState<DraftForm>(design ? {
    title: design.title,
    description: design.description,
    category: design.category,
    garment_type: design.garment_type,
    base_price: String(design.base_price),
  } : emptyForm)
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const chooseImages = async () => {
    const available = MAX_IMAGES - (design?.images.length || 0) - assets.length
    if (available <= 0) return setError(`Each design can have up to ${MAX_IMAGES} images.`)
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      orderedSelection: true,
      quality: 0.85,
      selectionLimit: available,
    })
    if (result.canceled) return
    const invalid = result.assets.find((asset) => {
      const mime = asset.mimeType || ""
      return !["image/jpeg", "image/png", "image/webp"].includes(mime) || !asset.fileSize || asset.fileSize > MAX_IMAGE_BYTES
    })
    if (invalid) return setError("Choose JPEG, PNG, or WebP images up to 5 MB each.")
    setError("")
    setAssets((current) => [...current, ...result.assets].slice(0, available + current.length))
  }

  const save = async () => {
    const price = Number(form.base_price)
    if (form.title.trim().length < 2 || form.description.trim().length < 10 || form.garment_type.trim().length < 2) return setError("Add a title, garment type, and a description of at least 10 characters.")
    if (!Number.isFinite(price) || price < 0 || price > 10_000_000) return setError("Enter a valid tailoring service price.")
    setSaving(true)
    setError("")
    try {
      let saved = await api<Design>(design ? `/api/vendor/designs/${design.id}` : "/api/vendor/designs", {
        method: design ? "PUT" : "POST",
        body: JSON.stringify({ ...form, title: form.title.trim(), description: form.description.trim(), garment_type: form.garment_type.trim(), base_price: price }),
      })
      for (const asset of assets) {
        const upload = new FormData()
        upload.append("file", {
          uri: asset.uri,
          name: asset.fileName || `design-${Date.now()}.jpg`,
          type: asset.mimeType || "image/jpeg",
        } as unknown as Blob)
        upload.append("sort_order", String(saved.images.length))
        saved = await api<Design>(`/api/vendor/designs/${saved.id}/images`, { method: "POST", body: upload })
      }
      await onSaved()
      onClose()
    } catch (value) {
      setError((value as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
    <View style={[styles.modal, { backgroundColor: colors.background }]}>
      <View style={styles.modalHeader}><View style={{ flex: 1 }}><Text style={[styles.modalTitle, { color: colors.text }]}>{design ? "Edit design" : "Create a design"}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", marginTop: 3 }}>Save details and photos together as a private draft.</Text></View><Pressable accessibilityLabel="Close" disabled={saving} onPress={onClose} style={[styles.close, { borderColor: colors.border }]}><X color={colors.text} size={22} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Title" maxLength={120} onChangeText={(title) => setForm((current) => ({ ...current, title }))} value={form.title} />
        <Field label="Description" maxLength={2000} multiline numberOfLines={5} onChangeText={(description) => setForm((current) => ({ ...current, description }))} style={{ minHeight: 112, textAlignVertical: "top" }} value={form.description} />
        <Text style={[styles.label, { color: colors.text }]}>Customer category</Text>
        <View style={styles.categories}>{categories.map((category) => <Pressable key={category} onPress={() => setForm((current) => ({ ...current, category }))} style={[styles.category, { backgroundColor: form.category === category ? colors.primary : colors.surface, borderColor: form.category === category ? colors.primary : colors.border }]}><Text style={{ color: form.category === category ? colors.white : colors.text, fontFamily: "Manrope_700Bold", textTransform: "capitalize" }}>{category}</Text></Pressable>)}</View>
        <Field label="Garment type" maxLength={100} onChangeText={(garment_type) => setForm((current) => ({ ...current, garment_type }))} placeholder="Kurta, blouse, suit…" value={form.garment_type} />
        <Field keyboardType="decimal-pad" label="Tailoring service price (₹)" maxLength={10} onChangeText={(base_price) => setForm((current) => ({ ...current, base_price: base_price.replace(/[^0-9.]/g, "") }))} value={form.base_price} />
        <View style={[styles.uploadPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.uploadCopy}><ImagePlus color={colors.primary} size={24} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>Design photos</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 12, marginTop: 3 }}>{(design?.images.length || 0) + assets.length}/{MAX_IMAGES} · JPEG, PNG or WebP · 5 MB each</Text></View></View><AppButton disabled={saving || (design?.images.length || 0) + assets.length >= MAX_IMAGES} onPress={() => void chooseImages()} variant="secondary"><Camera color={colors.text} size={18} />Choose photos</AppButton></View>
        {!!assets.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>{assets.map((asset, index) => <View key={`${asset.assetId || asset.uri}-${index}`}><Image source={{ uri: asset.uri }} style={styles.preview} /><Pressable accessibilityLabel="Remove selected image" onPress={() => setAssets((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={[styles.remove, { backgroundColor: colors.danger }]}><X color={colors.white} size={14} /></Pressable></View>)}</ScrollView>}
        {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 14 }}>{error}</Text>}
        <AppButton disabled={saving} onPress={() => void save()}>{saving ? "Saving and uploading…" : assets.length ? "Save draft & upload" : "Save draft"}</AppButton>
      </ScrollView>
    </View>
  </Modal>
}

export default function StudioDesignsScreen() {
  const { colors } = useTheme()
  const [designs, setDesigns] = useState<Design[]>([])
  const [filter, setFilter] = useState<ListingFilter>("all")
  const [editing, setEditing] = useState<Design | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try { setDesigns(await api<Design[]>("/api/vendor/designs")) } catch (value) { setError((value as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const submit = async (design: Design) => {
    setBusyId(design.id)
    try { await api(`/api/vendor/designs/${design.id}/submit`, { method: "POST" }); await load() } catch (value) { Alert.alert("Could not submit design", (value as Error).message) } finally { setBusyId(null) }
  }
  const remove = (design: Design) => Alert.alert("Delete design?", `Delete “${design.title}” and all uploaded images?`, [{ text: "Keep design", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { setBusyId(design.id); try { await api(`/api/vendor/designs/${design.id}`, { method: "DELETE" }); await load() } catch (value) { Alert.alert("Could not delete design", (value as Error).message) } finally { setBusyId(null) } } }])

  const filters: Array<{ label: string; value: ListingFilter }> = [{ label: "All", value: "all" }, { label: "Draft", value: "draft" }, { label: "Pending", value: "submitted" }, { label: "Approved", value: "approved" }, { label: "Rejected", value: "rejected" }]
  const count = (value: ListingFilter) => value === "all" ? designs.length : designs.filter((design) => design.status === value).length
  const visibleDesigns = filter === "all" ? designs : designs.filter((design) => design.status === filter)

  return <Screen><PageHeader action={<Pressable accessibilityLabel="Create design" onPress={() => setEditing(null)} style={[styles.add, { backgroundColor: colors.primary }]}><Plus color={colors.white} size={22} /></Pressable>} back subtitle="Create drafts, upload photos, and submit listings for administrator review." title="Studio designs" />
    {!loading && !error && <ScrollView contentContainerStyle={styles.statusFilters} horizontal showsHorizontalScrollIndicator={false}>{filters.map((item) => <Pressable key={item.value} onPress={() => setFilter(item.value)} style={[styles.statusFilter, { backgroundColor: filter === item.value ? colors.primary : colors.surface, borderColor: filter === item.value ? colors.primary : colors.border }]}><Text style={{ color: filter === item.value ? colors.white : colors.text, fontFamily: "Manrope_700Bold", fontSize: 12 }}>{item.label} · {count(item.value)}</Text></Pressable>)}</ScrollView>}
    {loading ? <LoadingState label="Opening your designs…" /> : error ? <ErrorState message={error} retry={() => void load()} /> : visibleDesigns.length ? visibleDesigns.map((design) => <View key={design.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{design.thumbnail_url || design.image_url ? <Image source={{ uri: absoluteUrl(design.thumbnail_url || design.image_url!), headers: currentAccessToken() ? { Authorization: `Bearer ${currentAccessToken()}` } : undefined }} style={styles.cover} /> : <View style={[styles.cover, styles.coverEmpty, { backgroundColor: colors.primarySoft }]}><ImagePlus color={colors.primary} size={34} /></View>}<View style={styles.cardBody}><View style={styles.titleRow}><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>{design.title}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", marginTop: 3 }}>{design.images.length} photo{design.images.length === 1 ? "" : "s"} · ₹{design.base_price.toLocaleString("en-IN")}</Text></View><Pill tone={design.status === "approved" ? "success" : design.status === "rejected" ? "primary" : "default"}>{design.status === "submitted" ? "pending" : design.status}</Pill></View><View style={styles.actions}><Pressable disabled={busyId === design.id || design.status === "submitted"} onPress={() => setEditing(design)} style={[styles.iconAction, { borderColor: colors.border }]}><Edit3 color={colors.text} size={18} /></Pressable><Pressable disabled={busyId === design.id || design.status === "submitted"} onPress={() => remove(design)} style={[styles.iconAction, { borderColor: colors.border }]}><Trash2 color={colors.danger} size={18} /></Pressable>{["draft", "rejected"].includes(design.status) && <View style={{ flex: 1 }}><AppButton disabled={busyId === design.id || design.images.length === 0} onPress={() => void submit(design)}><Send color={colors.white} size={17} />Submit for review</AppButton></View>}</View></View></View>) : <EmptyState message={designs.length ? `No ${filter === "submitted" ? "pending" : filter} designs are available.` : "Create a draft and add at least one photo before submitting it for review."} title={designs.length ? "No matching designs" : "No designs yet"} />}
    {editing !== undefined && <DesignForm design={editing} onClose={() => setEditing(undefined)} onSaved={load} />}
  </Screen>
}

const styles = StyleSheet.create({ modal: { flex: 1 }, modalHeader: { alignItems: "flex-start", borderBottomColor: "rgba(128,128,128,.25)", borderBottomWidth: 1, flexDirection: "row", gap: 14, padding: 20, paddingTop: 24 }, modalTitle: { fontFamily: "Fraunces_700Bold", fontSize: 28 }, close: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 44, justifyContent: "center", width: 44 }, form: { padding: 20, paddingBottom: 42 }, label: { fontFamily: "Manrope_700Bold", fontSize: 13, marginBottom: 8 }, categories: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }, category: { borderRadius: 99, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }, uploadPanel: { borderRadius: 18, borderWidth: 1, gap: 14, marginBottom: 16, padding: 15 }, uploadCopy: { alignItems: "center", flexDirection: "row", gap: 11 }, preview: { borderRadius: 14, height: 108, marginRight: 10, width: 92 }, remove: { alignItems: "center", borderRadius: 99, height: 25, justifyContent: "center", position: "absolute", right: 4, top: -5, width: 25 }, add: { alignItems: "center", borderRadius: 14, height: 46, justifyContent: "center", width: 46 }, statusFilters: { gap: 8, paddingBottom: 14 }, statusFilter: { borderRadius: 99, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 }, card: { borderRadius: 20, borderWidth: 1, flexDirection: "row", marginBottom: 12, overflow: "hidden" }, cover: { height: 172, width: 118 }, coverEmpty: { alignItems: "center", justifyContent: "center" }, cardBody: { flex: 1, justifyContent: "space-between", padding: 14 }, titleRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 }, cardTitle: { fontFamily: "Fraunces_700Bold", fontSize: 20 }, actions: { alignItems: "center", flexDirection: "row", gap: 8 }, iconAction: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 50, justifyContent: "center", width: 45 } })
