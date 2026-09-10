import { useCallback, useRef, useState } from "react"
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useFocusEffect, useRouter } from "expo-router"
import * as Crypto from "expo-crypto"
import { AppButton, ErrorState, Field, LoadingState, PageHeader, Screen } from "./ui"
import { CustomOrderReferences } from "./CustomOrderReferences"
import { OrderChoice } from "./OrderChoice"
import { absoluteUrl, api, currentAccessToken } from "@/lib/api"
import { orderPieces, resizeFits } from "@/lib/customOrderDraft"
import { useTheme } from "@/theme/theme"
import type { DeliveryAddress, Design, MeasurementProfile, Order, VendorDirectoryItem } from "@/types/api"

type Entry = { id: string; fits: string[]; designs: number[]; photos: string[]; notes: string; colour: string; fabric: string; cloth: "customer_provided" | "vendor_supplied" }
const fresh = (): Entry => ({ id: Crypto.randomUUID(), fits: [""], designs: [], photos: [], notes: "", colour: "", fabric: "", cloth: "customer_provided" })

export function CustomOrderComposer({ vendorId }: { vendorId: string }) {
  const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter()
  const scroll = useRef<ScrollView>(null); const sending = useRef(false)
  const [entries, setEntries] = useState<Entry[]>(() => [fresh()]); const [active, setActive] = useState<string | null>(null)
  const [vendor, setVendor] = useState<VendorDirectoryItem | null>(null)
  const [fits, setFits] = useState<MeasurementProfile[]>([]); const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [catalog, setCatalog] = useState<Design[]>([]); const [address, setAddress] = useState("")
  const [fulfilment, setFulfilment] = useState("home_delivery"); const [loading, setLoading] = useState(true)
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false)
  const [review, setReview] = useState(false); const [attempted, setAttempted] = useState(false)
  const [more, setMore] = useState<string | null>(null); const [removed, setRemoved] = useState<{ entry: Entry; index: number } | null>(null)
  const total = entries.reduce((sum, item) => sum + item.fits.length, 0)
  const update = (id: string, patch: Partial<Entry>) => setEntries((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  const valid = (item: Entry) => item.notes.trim().length >= 10 && item.fits.every((id) => fits.some((fit) => String(fit.id) === id))
  const load = useCallback(async () => {
    setError("")
    try {
      const [shop, profiles, saved] = await Promise.all([api<VendorDirectoryItem>(`/api/vendors/${vendorId}`), api<MeasurementProfile[]>("/api/measurements"), api<DeliveryAddress[]>("/api/addresses")])
      setVendor(shop); setFits(profiles); setAddresses(saved)
      setAddress((current) => saved.some((item) => String(item.id) === current) ? current : String((saved.find((item) => item.is_default) || saved[0])?.id || ""))
    } catch (reason) { setError((reason as Error).message) } finally { setLoading(false) }
  }, [vendorId])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const reviewOrder = () => {
    setAttempted(true)
    const invalid = entries.find((item) => !valid(item))
    if (invalid) { setActive(invalid.id); setError("Complete the highlighted garment details."); scroll.current?.scrollTo({ y: 0 }); return }
    if (!address) { setError("Choose an address for this order."); return }
    setError(""); setReview(true); setActive(null); scroll.current?.scrollTo({ y: 0 })
  }
  const submit = async () => {
    if (sending.current || busy || !vendor || !address || !entries.every(valid) || total > 20) return
    sending.current = true; setSaving(true); setError("")
    try {
      const design = await api<Design>(`/api/vendors/${vendor.id}/custom-design`, { method: "POST" })
      const order = await api<Order>("/api/orders", { method: "POST", body: JSON.stringify({ address_id: Number(address), fulfilment_method: fulfilment, product_items: [], items: orderPieces(entries, design.id) }) })
      router.replace({ pathname: "/order/[id]", params: { id: String(order.id) } })
    } catch (reason) { setError((reason as Error).message) } finally { sending.current = false; setSaving(false) }
  }
  if (loading) return <Screen><LoadingState label="Preparing your order…" /></Screen>
  if (!vendor) return <Screen><PageHeader back title="Custom order" /><ErrorState message={error || "Shop unavailable"} retry={() => void load()} /></Screen>
  const text = { color: colors.text }; const muted = { color: colors.muted, fontSize: 12 }
  return <Screen scroll={false}><PageHeader back title={review ? "Review order" : "Custom tailoring"} subtitle={vendor.shop_name} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
      {!vendor.accepts_custom_orders && <Text style={muted}>Unavailable · Vendor pickup setup pending</Text>}
      {!fits.length && <AppButton variant="secondary" onPress={() => router.push("/profile/measurements")}>Add measurements</AppButton>}
      {entries.map((entry, index) => {
        const selected = catalog.find((item) => item.id === entry.designs[0]); const url = entry.photos[0] ? `/api/order-reference-photos/${entry.photos[0]}` : selected?.thumbnail_url || selected?.image_url
        const open = !review && (active === entry.id || active === null && entries.length === 1)
        return <View key={entry.id} style={{ borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: 14, padding: 12, gap: 12, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={busy || saving || review} onPress={() => setActive(open ? "" : entry.id)} style={{ flex: 1, flexDirection: "row", gap: 8, minHeight: 44 }}>
            {!!url && <Image source={{ uri: absoluteUrl(url), headers: { Authorization: `Bearer ${currentAccessToken()}` } }} style={{ width: 42, height: 50 }} resizeMode="contain" />}
            <View style={{ flex: 1 }}><Text style={text}>{selected?.title || `Garment ${index + 1}`}</Text><Text style={muted}>{entry.fits.length} pieces · {valid(entry) ? "Ready" : "To complete"}</Text><Text style={muted}>{entry.fits.map((id) => fits.find((item) => String(item.id) === id)?.profile_name || "Choose measurements").join(", ")}</Text></View>
          </Pressable>{!review && entries.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Remove garment ${index + 1}`} disabled={busy || saving} onPress={() => { setRemoved({ entry, index }); setEntries((items) => items.filter((item) => item.id !== entry.id)); if (active === entry.id) setActive("") }} style={{ padding: 10, minHeight: 44 }}><Text style={muted}>Remove</Text></Pressable>}</View>
          {review && <><Text style={text}>{entry.notes}</Text><Text style={muted}>{entry.cloth === "vendor_supplied" ? `Vendor cloth${entry.colour ? ` · ${entry.colour}` : ""}` : "My cloth"}{entry.fabric ? ` · ${entry.fabric}` : ""}</Text></>}
          {open && <>
            <CustomOrderReferences single key={entry.id} vendorId={vendor.id} designs={entry.designs} photos={entry.photos} onDesigns={(designs) => update(entry.id, { designs })} onPhotos={(photos) => update(entry.id, { photos })} onBusy={setBusy} onCatalog={setCatalog} />
            <OrderChoice label="Quantity" disabled={busy} value={String(entry.fits.length)} options={Array.from({ length: 20 - total + entry.fits.length }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(value) => update(entry.id, { fits: resizeFits(entry.fits, Number(value)) })} />
            {entry.fits.length > 1 && entry.fits[0] && <AppButton variant="secondary" disabled={busy} onPress={() => update(entry.id, { fits: entry.fits.map(() => entry.fits[0]) })}>Use piece 1 measurements for all</AppButton>}
            {entry.fits.map((fit, i) => <View key={i} style={{ gap: 4 }}><OrderChoice label={`Piece ${i + 1} measurements`} disabled={busy} value={fit} options={fits.map((item) => ({ value: String(item.id), label: `${item.profile_name} · ${item.garment_type}` }))} onChange={(value) => update(entry.id, { fits: entry.fits.map((id, position) => position === i ? value : id) })} />{attempted && !fits.some((item) => String(item.id) === fit) && <Text style={{ color: colors.danger }}>Choose measurements for this piece.</Text>}</View>)}
            <Field label="Describe this garment" value={entry.notes} maxLength={900} multiline editable={!busy} onChangeText={(notes) => update(entry.id, { notes })} />
            {attempted && entry.notes.trim().length < 10 && <Text style={{ color: colors.danger }}>Add at least 10 characters.</Text>}
            <OrderChoice label="Who provides the cloth?" disabled={busy} value={entry.cloth} options={[{ value: "customer_provided", label: "I will provide it" }, { value: "vendor_supplied", label: "Vendor provides it" }]} onChange={(cloth) => update(entry.id, { cloth: cloth as Entry["cloth"] })} />
            {entry.cloth === "vendor_supplied" && <Field label="Colour preference (optional)" editable={!busy} maxLength={100} value={entry.colour} onChangeText={(colour) => update(entry.id, { colour })} />}
            <AppButton variant="secondary" disabled={busy} onPress={() => setMore(more === entry.id ? null : entry.id)}>More details</AppButton>
            {more === entry.id && <Field label="Fabric preference (optional)" editable={!busy} maxLength={100} value={entry.fabric} onChangeText={(fabric) => update(entry.id, { fabric })} />}
          </>}
        </View>
      })}
      {!review && <>
        {removed && <View style={{ gap: 6 }}><Text style={muted}>Garment removed</Text><AppButton variant="secondary" disabled={busy || total + removed.entry.fits.length > 20} onPress={() => { const position = Math.min(removed.index, entries.length); setEntries((items) => [...items.slice(0, position), removed.entry, ...items.slice(position)]); setRemoved(null) }}>Undo</AppButton>{total + removed.entry.fits.length > 20 && <Text style={muted}>Reduce quantity to restore it.</Text>}</View>}
        <AppButton variant="secondary" disabled={busy || total >= 20} onPress={() => { const item = fresh(); setEntries([...entries, item]); setActive(item.id) }}>Add another garment</AppButton><Text style={muted}>{total}/20 pieces{total === 20 ? " · Limit reached" : ""}</Text>
        {addresses.length ? <OrderChoice label="Address" value={address} options={addresses.map((item) => ({ value: String(item.id), label: `${item.recipient_name} · ${item.street_address}` }))} onChange={setAddress} /> : <AppButton variant="secondary" onPress={() => router.push("/profile/addresses")}>Add address</AppButton>}
        <OrderChoice label="Fulfilment" value={fulfilment} options={[{ value: "home_delivery", label: "Home delivery" }, { value: "customer_self_pickup", label: "Self pickup" }]} onChange={setFulfilment} />
      </>}
      {review && <><Text style={text}>{addresses.find((item) => String(item.id) === address)?.street_address}</Text><Text style={text}>{fulfilment === "home_delivery" ? "Home delivery" : "Self pickup"}</Text><AppButton variant="secondary" disabled={saving} onPress={() => setReview(false)}>Edit order</AppButton></>}
      <Text style={muted}>The vendor confirms tailoring prices by invoice for your approval.</Text>
    </ScrollView>
    <View style={{ paddingTop: 12, paddingBottom: Math.max(insets.bottom, 8), borderTopWidth: 1, borderColor: colors.border, gap: 8 }}><Text style={text}>{total} pieces · {entries.length} garments</Text><AppButton disabled={busy || saving || !vendor.accepts_custom_orders || !fits.length || !addresses.length} onPress={() => review ? void submit() : reviewOrder()}>{saving ? "Placing order…" : review ? "Place custom order" : "Review order"}</AppButton></View>
    </KeyboardAvoidingView>
  </Screen>
}
