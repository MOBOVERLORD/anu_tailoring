import * as Location from "expo-location"
import { useCallback, useEffect, useState } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { LocateFixed, MapPin, Plus, Trash2, X } from "lucide-react-native"
import { useSession } from "@/auth/SessionProvider"
import { api } from "@/lib/api"
import type { DeliveryAddress, ResolvedLocation } from "@/types/api"
import { AppButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function AddressesScreen() {
  const { colors } = useTheme()
  const { profile } = useSession()
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [adding, setAdding] = useState(false)
  const [recipient, setRecipient] = useState(profile?.full_name || "")
  const [phone, setPhone] = useState(profile?.phone || "")
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null)
  const [street, setStreet] = useState("")
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try { setAddresses(await api<DeliveryAddress[]>("/api/addresses")) } catch (value) { setError((value as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const locate = async () => {
    setLocating(true); setError("")
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== "granted") throw new Error("Location permission is required when you choose Locate me.")
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const place = await api<ResolvedLocation>("/api/addresses/resolve-location", { method: "POST", body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy }) })
      setResolved(place)
      setStreet(place.street_address || place.formatted_address)
    } catch (value) { setError((value as Error).message) } finally { setLocating(false) }
  }

  const save = async () => {
    if (!resolved) return setError("Locate this address before saving it.")
    setSaving(true); setError("")
    try {
      await api<DeliveryAddress>("/api/addresses", { method: "POST", body: JSON.stringify({
        recipient_name: recipient.trim(), phone_number: phone.trim(), street_address: street.trim(),
        city: resolved.city, state: resolved.state, postal_code: resolved.postal_code,
        country: resolved.country || "India", is_default: addresses.length === 0,
        latitude: resolved.latitude, longitude: resolved.longitude, location_token: resolved.location_token,
      }) })
      setAdding(false); setResolved(null); setStreet(""); await load()
    } catch (value) { setError((value as Error).message) } finally { setSaving(false) }
  }

  const remove = (address: DeliveryAddress) => Alert.alert("Delete address?", address.street_address, [
    { text: "Keep", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/api/addresses/${address.id}`, { method: "DELETE" }); await load() } catch (value) { setError((value as Error).message) } } },
  ])

  if (loading) return <Screen scroll={false}><LoadingState label="Loading addresses…" /></Screen>
  return <Screen>
    <PageHeader action={<Pressable accessibilityLabel={adding ? "Close address form" : "Add address"} onPress={() => { setAdding((current) => !current); setError("") }} style={[styles.iconButton, { backgroundColor: colors.primary }]}>{adding ? <X color={colors.white} size={21} /> : <Plus color={colors.white} size={21} />}</Pressable>} back subtitle="Saved delivery locations for checkout." title="Delivery addresses" />
    {error && !adding && !addresses.length ? <ErrorState message={error} retry={() => void load()} /> : null}
    {adding && <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 21 }}>Pin the delivery point</Text>
      <Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 20, marginBottom: 14 }}>Use your device location to securely fill the mapped address.</Text>
      <AppButton disabled={locating || saving} onPress={() => void locate()} variant="secondary"><LocateFixed color={colors.text} size={18} />{locating ? "Locating…" : resolved ? "Update location" : "Locate me"}</AppButton>
      {resolved && <View style={[styles.resolved, { backgroundColor: colors.primarySoft }]}><MapPin color={colors.primary} size={19} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold", lineHeight: 20 }}>{resolved.formatted_address}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 11, marginTop: 4 }}>{resolved.provider_name}</Text></View></View>}
      <Field label="Recipient name" maxLength={100} onChangeText={setRecipient} value={recipient} />
      <Field keyboardType="phone-pad" label="Phone number" maxLength={20} onChangeText={setPhone} value={phone} />
      <Field label="House, building, street and area" maxLength={500} multiline numberOfLines={3} onChangeText={setStreet} style={{ minHeight: 88, textAlignVertical: "top" }} value={street} />
      {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 12 }}>{error}</Text>}
      <AppButton disabled={saving || !resolved || recipient.trim().length < 2 || phone.trim().length < 10 || street.trim().length < 5} onPress={() => void save()}>{saving ? "Saving…" : "Save address"}</AppButton>
    </View>}
    {!adding && (addresses.length ? addresses.map((address) => <View key={address.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><MapPin color={colors.primary} size={22} /><View style={{ flex: 1 }}><View style={styles.cardTitle}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>{address.recipient_name}</Text>{address.is_default && <Pill tone="primary">Default</Pill>}</View><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 19, marginTop: 5 }}>{address.street_address}, {address.city}, {address.state} {address.postal_code}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_500Medium", fontSize: 12, marginTop: 5 }}>{address.phone_number}</Text></View><Pressable accessibilityLabel="Delete address" onPress={() => remove(address)}><Trash2 color={colors.danger} size={19} /></Pressable></View>) : <EmptyState message="Use Locate me to save your first delivery point." title="No addresses yet" />)}
  </Screen>
}

const styles = StyleSheet.create({
  iconButton: { alignItems: "center", borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  form: { borderRadius: 20, borderWidth: 1, marginBottom: 18, padding: 16 },
  resolved: { borderRadius: 15, flexDirection: "row", gap: 10, marginVertical: 14, padding: 13 },
  card: { alignItems: "flex-start", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 11, padding: 15 },
  cardTitle: { alignItems: "center", flexDirection: "row", gap: 8 },
})
