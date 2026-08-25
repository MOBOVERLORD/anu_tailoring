import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Plus, Ruler, Trash2, X } from "lucide-react-native"
import { api } from "@/lib/api"
import type { MeasurementCategory, MeasurementProfile } from "@/types/api"
import { AppButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { useTheme } from "@/theme/theme"

export default function MeasurementsScreen() {
  const { colors } = useTheme()
  const [profiles, setProfiles] = useState<MeasurementProfile[]>([])
  const [categories, setCategories] = useState<MeasurementCategory[]>([])
  const [adding, setAdding] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [profileName, setProfileName] = useState("")
  const [unit, setUnit] = useState<"inches" | "cm">("inches")
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      const [saved, catalog] = await Promise.all([api<MeasurementProfile[]>("/api/measurements"), api<MeasurementCategory[]>("/api/measurements/categories")])
      setProfiles(saved); setCategories(catalog); setCategoryId((current) => current || catalog[0]?.id || null)
    } catch (value) { setError((value as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const category = useMemo(() => categories.find((item) => item.id === categoryId) || null, [categories, categoryId])

  const chooseCategory = (next: MeasurementCategory) => { setCategoryId(next.id); setValues({}) }
  const save = async () => {
    if (!category) return
    const measurements = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => [key, Number(value)]))
    if (!Object.keys(measurements).length || Object.values(measurements).some((value) => !Number.isFinite(value) || value <= 0 || value > 300)) return setError("Add at least one realistic measurement between 0 and 300.")
    setSaving(true); setError("")
    try {
      await api<MeasurementProfile>("/api/measurements", { method: "POST", body: JSON.stringify({ profile_name: profileName.trim(), gender: category.gender, garment_type: category.garment_type, standard_size: null, unit, measurements, chest: null, waist: null, hips: null, shoulder_width: null, sleeve_length: null, inseam: null, neck: null, height: null, notes: null }) })
      setAdding(false); setProfileName(""); setValues({}); await load()
    } catch (value) { setError((value as Error).message) } finally { setSaving(false) }
  }
  const remove = (profile: MeasurementProfile) => Alert.alert("Delete measurements?", `Remove “${profile.profile_name}”?`, [
    { text: "Keep", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/api/measurements/${profile.id}`, { method: "DELETE" }); await load() } catch (value) { setError((value as Error).message) } } },
  ])

  if (loading) return <Screen scroll={false}><LoadingState label="Loading measurements…" /></Screen>
  return <Screen>
    <PageHeader action={<Pressable accessibilityLabel={adding ? "Close form" : "Add measurements"} onPress={() => { setAdding((current) => !current); setError("") }} style={[styles.iconButton, { backgroundColor: colors.primary }]}>{adding ? <X color={colors.white} size={21} /> : <Plus color={colors.white} size={21} />}</Pressable>} back subtitle="Save separate fit profiles for yourself and family." title="Measurements" />
    {error && !adding && !profiles.length ? <ErrorState message={error} retry={() => void load()} /> : null}
    {adding && <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Field label="Profile name" maxLength={50} onChangeText={setProfileName} placeholder="My kurta, Dad's shirt…" value={profileName} />
      <Text style={[styles.label, { color: colors.text }]}>Garment category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 17 }}>{categories.map((item) => <Pressable key={item.id} onPress={() => chooseCategory(item)} style={[styles.choice, { backgroundColor: categoryId === item.id ? colors.primary : colors.surfaceMuted, borderColor: categoryId === item.id ? colors.primary : colors.border }]}><Text style={{ color: categoryId === item.id ? colors.white : colors.text, fontFamily: "Manrope_700Bold" }}>{item.name}</Text></Pressable>)}</ScrollView>
      <Text style={[styles.label, { color: colors.text }]}>Unit</Text>
      <View style={styles.unitRow}>{(["inches", "cm"] as const).map((value) => <Pressable key={value} onPress={() => setUnit(value)} style={[styles.unit, { backgroundColor: unit === value ? colors.primarySoft : colors.surfaceMuted, borderColor: unit === value ? colors.primary : colors.border }]}><Text style={{ color: unit === value ? colors.primary : colors.text, fontFamily: "Manrope_700Bold" }}>{value}</Text></Pressable>)}</View>
      {category?.measurement_fields.map((field) => <Field key={field.key} keyboardType="decimal-pad" label={`${field.label} (${unit === "inches" ? "in" : "cm"})`} maxLength={6} onChangeText={(value) => setValues((current) => ({ ...current, [field.key]: value.replace(/[^0-9.]/g, "") }))} value={values[field.key] || ""} />)}
      {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 12 }}>{error}</Text>}
      <AppButton disabled={saving || profileName.trim().length < 2 || !category} onPress={() => void save()}>{saving ? "Saving…" : "Save measurements"}</AppButton>
    </View>}
    {!adding && (profiles.length ? profiles.map((profile) => <View key={profile.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.ruler, { backgroundColor: colors.primarySoft }]}><Ruler color={colors.primary} size={21} /></View><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 19 }}>{profile.profile_name}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_500Medium", fontSize: 12, marginTop: 4 }}>{profile.garment_type.replaceAll("_", " ")} · {profile.unit}</Text><View style={styles.values}>{Object.entries(profile.measurements).slice(0, 4).map(([key, value]) => <Pill key={key}>{key.replaceAll("_", " ")} {value}</Pill>)}</View></View><Pressable accessibilityLabel="Delete measurement profile" onPress={() => remove(profile)}><Trash2 color={colors.danger} size={19} /></Pressable></View>) : <EmptyState message="Add a named fit profile to use while placing tailoring orders." title="No measurements yet" />)}
  </Screen>
}

const styles = StyleSheet.create({
  iconButton: { alignItems: "center", borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  form: { borderRadius: 20, borderWidth: 1, marginBottom: 18, padding: 16 },
  label: { fontFamily: "Manrope_700Bold", fontSize: 13, marginBottom: 8 },
  choice: { borderRadius: 99, borderWidth: 1, marginRight: 8, paddingHorizontal: 14, paddingVertical: 10 },
  unitRow: { flexDirection: "row", gap: 8, marginBottom: 17 },
  unit: { borderRadius: 12, borderWidth: 1, flex: 1, padding: 11 },
  card: { alignItems: "flex-start", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 11, padding: 15 },
  ruler: { alignItems: "center", borderRadius: 13, height: 43, justifyContent: "center", width: 43 },
  values: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 9 },
})
