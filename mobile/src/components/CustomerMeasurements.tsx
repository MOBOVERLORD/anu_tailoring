import { useCallback, useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { api } from "@/lib/api"
import { AppButton, Field } from "@/components/ui"
import { useTheme } from "@/theme/theme"
import type { MeasurementCategory } from "@/types/api"

export interface VendorMeasurement {
  id: number; relationship_id: number; created_by_vendor_id: number; profile_name: string;
  garment_type: string; gender: string; unit: string; measurements: Record<string, number>;
  notes: string | null; created_at: string; updated_at: string; vendor_name?: string;
}

export function CustomerMeasurements({ relationshipId, declined = false, shared = false }: { relationshipId?: number; declined?: boolean; shared?: boolean }) {
  const { colors } = useTheme()
  const endpoint = shared ? "/api/measurements/vendor-recorded" : `/api/vendor/customers/${relationshipId}/measurements`
  const [profiles, setProfiles] = useState<VendorMeasurement[]>([])
  const [categories, setCategories] = useState<MeasurementCategory[]>([])
  const [editing, setEditing] = useState<number | null | undefined>(undefined)
  const [name, setName] = useState("")
  const [garment, setGarment] = useState("")
  const [unit, setUnit] = useState("inches")
  const [values, setValues] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    try {
      const [saved, catalog] = await Promise.all([api<VendorMeasurement[]>(endpoint), api<MeasurementCategory[]>("/api/measurements/categories")])
      setProfiles(saved); setCategories(catalog); setError("")
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [endpoint])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const category = categories.find(c => c.garment_type === garment)
  const edit = (profile?: VendorMeasurement) => {
    setEditing(profile?.id ?? null); setName(profile?.profile_name || ""); setGarment(profile?.garment_type || categories[0]?.garment_type || "")
    setUnit(profile?.unit || "inches"); setValues(Object.fromEntries(Object.entries(profile?.measurements || {}).map(([k, v]) => [k, String(v)]))); setNotes(profile?.notes || ""); setError("")
  }
  const save = async () => {
    const measurements = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, Number(v)]))
    if (!category || name.trim().length < 2 || !Object.keys(measurements).length || Object.values(measurements).some(v => !Number.isFinite(v) || v <= 0 || v > 300)) return setError("Choose a category, enter a name and measurements greater than 0 and at most 300.")
    setBusy(true); setError("")
    try {
      const saved = await api<VendorMeasurement>(editing === null ? endpoint : `${endpoint}/${editing}`, { method: editing === null ? "POST" : "PATCH", body: JSON.stringify({ profile_name: name.trim(), garment_type: garment, unit, measurements, notes: notes.trim() || null }) })
      setProfiles(current => [saved, ...current.filter(p => p.id !== saved.id)]); setEditing(undefined)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const remove = (profile: VendorMeasurement) => Alert.alert("Delete measurements?", `Remove ${profile.profile_name}?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => {
    setBusy(true)
    try { await api(`${endpoint}/${profile.id}`, { method: "DELETE" }); setProfiles(current => current.filter(p => p.id !== profile.id)); setError("") } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  } }])
  return <View style={{ marginTop: 24, gap: 12 }}>
    <Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 23 }}>{shared ? "Measurements from your vendors" : `Measurements (${profiles.length})`}</Text>
    <Text style={{ color: colors.muted }}>{shared ? "Read-only profiles shared through accepted vendor relationships." : "Recorded by your shop. Visible to the customer after they accept the relationship."}</Text>
    {loading && <Text style={{ color: colors.muted }}>Loading measurements…</Text>}
    {!!error && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>{editing === undefined && <AppButton onPress={() => void load()} variant="secondary">Retry</AppButton>}</>}
    {!shared && !declined && editing === undefined && <AppButton disabled={busy || loading} onPress={() => edit()}>Add measurement profile</AppButton>}
    {editing !== undefined && <View style={{ backgroundColor: colors.surface, padding: 16, borderRadius: 16 }}>
      <Field label="Profile name" value={name} onChangeText={setName} maxLength={50} editable={!busy} />
      <Text style={{ color: colors.text, marginBottom: 8 }}>Garment category</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>{categories.map(c => <Pressable accessibilityRole="button" disabled={busy} key={c.id} onPress={() => { setGarment(c.garment_type); setValues({}) }} style={{ padding: 12, borderRadius: 12, backgroundColor: garment === c.garment_type ? colors.primarySoft : colors.surfaceMuted }}><Text style={{ color: colors.text }}>{c.name}</Text></Pressable>)}</View>
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>{["inches", "cm"].map(u => <Pressable accessibilityRole="button" disabled={busy} key={u} onPress={() => {
        if (u !== unit) { setValues(current => Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v && Number.isFinite(Number(v)) ? String(Math.round(Number(v) * (u === "cm" ? 2.54 : 1 / 2.54) * 100) / 100) : v]))); setUnit(u) }
      }} style={{ padding: 12, backgroundColor: unit === u ? colors.primarySoft : colors.surfaceMuted, borderRadius: 12 }}><Text style={{ color: colors.text }}>{u}</Text></Pressable>)}</View>
      {category?.measurement_fields.map(f => <Field key={f.key} label={`${f.label} (${unit})`} keyboardType="decimal-pad" value={values[f.key] || ""} editable={!busy} onChangeText={v => setValues(current => ({ ...current, [f.key]: v.replace(/[^0-9.]/g, "") }))} />)}
      <Field label="Notes" multiline value={notes} onChangeText={setNotes} maxLength={1000} editable={!busy} />
      <AppButton disabled={busy} onPress={() => void save()}>{busy ? "Saving…" : "Save measurements"}</AppButton>
      <View style={{ marginTop: 10 }}><AppButton disabled={busy} variant="secondary" onPress={() => setEditing(undefined)}>Cancel</AppButton></View>
    </View>}
    {editing === undefined && profiles.map(p => <View key={p.id} style={{ padding: 16, borderRadius: 16, backgroundColor: colors.surface, gap: 8 }}>
      <Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>{p.profile_name}</Text>
      <Text style={{ color: colors.muted }}>{p.garment_type.replaceAll("_", " ")} · {p.unit}{p.vendor_name ? ` · Recorded by ${p.vendor_name}` : ""}</Text>
      {Object.entries(p.measurements).map(([k, v]) => <Text key={k} style={{ color: colors.text }}>{categories.find(c => c.garment_type === p.garment_type)?.measurement_fields.find(f => f.key === k)?.label || k.replaceAll("_", " ")}: {v} {p.unit}</Text>)}
      {!!p.notes && <Text style={{ color: colors.muted }}>{p.notes}</Text>}
      <Text style={{ color: colors.muted }}>Updated {new Date(p.updated_at).toLocaleDateString("en-IN")}</Text>
      {!shared && <><AppButton disabled={busy || declined} variant="secondary" onPress={() => edit(p)}>Edit</AppButton><AppButton disabled={busy} variant="danger" onPress={() => remove(p)}>Delete</AppButton></>}
    </View>)}
    {!loading && !error && profiles.length === 0 && <Text style={{ color: colors.muted }}>No vendor-recorded measurements yet.</Text>}
  </View>
}
