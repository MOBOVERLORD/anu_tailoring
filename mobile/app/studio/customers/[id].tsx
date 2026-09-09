import { useCallback, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { Mail, NotebookPen, Phone, ReceiptIndianRupee, Ruler, ShieldCheck, UserRound } from "lucide-react-native"
import { useFocusEffect, useLocalSearchParams } from "expo-router"

import { AppButton, ErrorState, Field, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { api } from "@/lib/api"
import { customerActivityDate, customerStatusDescription, customerStatusLabel, customerStatusTone } from "@/lib/vendorCustomers"
import { useTheme } from "@/theme/theme"
import type { VendorCustomerRelationship } from "@/types/api"
import { CustomerMeasurements } from "@/components/CustomerMeasurements"

export default function StudioCustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const relationshipId = Number(id)
  const { colors } = useTheme()
  const [customer, setCustomer] = useState<VendorCustomerRelationship | null>(null)
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (!Number.isInteger(relationshipId) || relationshipId <= 0) {
      setError("This customer link is invalid.")
      setLoading(false)
      return
    }
    setError("")
    try {
      const response = await api<VendorCustomerRelationship>(`/api/vendor/customers/${relationshipId}`)
      setCustomer(response)
      setNotes(response.vendor_notes || "")
    } catch (value) {
      setError((value as Error).message)
    } finally {
      setLoading(false)
    }
  }, [relationshipId])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const saveNotes = async () => {
    if (!customer) return
    setSaving(true)
    setError("")
    try {
      const response = await api<VendorCustomerRelationship>(`/api/vendor/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ vendor_notes: notes.trim() || null }),
      })
      setCustomer(response)
      setNotes(response.vendor_notes || "")
    } catch (value) {
      setError((value as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Screen><PageHeader back title="Customer" /><LoadingState label="Opening customer…" /></Screen>
  if (!customer) return <Screen><PageHeader back title="Customer" /><ErrorState message={error || "Customer not found"} retry={() => void load()} /></Screen>

  const statusMoment = customer.status === "active" && customer.accepted_at
    ? `Accepted ${customerActivityDate(customer.accepted_at)}`
    : customer.status === "declined" && customer.declined_at
      ? `Declined ${customerActivityDate(customer.declined_at)}`
      : customer.invited_at
        ? `Invited ${customerActivityDate(customer.invited_at)}`
        : "Waiting for customer approval"

  return <Screen>
    <PageHeader back subtitle="Relationship overview and vendor-private information." title={customer.full_name} />
    <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}><Text style={{ color: colors.primary, fontFamily: "Fraunces_700Bold", fontSize: 27 }}>{customer.full_name.trim().charAt(0).toUpperCase()}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 23 }}>{customer.full_name}</Text>
        <View style={{ marginTop: 7 }}><Pill tone={customerStatusTone(customer.status)}>{customerStatusLabel(customer.status)}</Pill></View>
      </View>
    </View>
    <View style={[styles.statusCard, { backgroundColor: colors.primarySoft }]}>
      <ShieldCheck color={colors.primary} size={22} />
      <Text style={{ color: colors.text, flex: 1, fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18 }}>{customerStatusDescription(customer.status)}</Text>
    </View>

    <Text style={[styles.sectionTitle, { color: colors.text }]}>Overview</Text>
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.detailRow}><Mail color={colors.primary} size={18} /><View style={{ flex: 1 }}><Text style={[styles.detailLabel, { color: colors.muted }]}>EMAIL</Text><Text selectable style={[styles.detailValue, { color: colors.text }]}>{customer.email}</Text></View></View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.detailRow}><Phone color={colors.primary} size={18} /><View style={{ flex: 1 }}><Text style={[styles.detailLabel, { color: colors.muted }]}>PHONE</Text><Text selectable style={[styles.detailValue, { color: colors.text }]}>{customer.phone || "Not provided"}</Text></View></View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.detailRow}><UserRound color={colors.primary} size={18} /><View style={{ flex: 1 }}><Text style={[styles.detailLabel, { color: colors.muted }]}>ACCOUNT</Text><Text style={[styles.detailValue, { color: colors.text }]}>{customer.account_role === "vendor" ? "Vendor account · linked as customer" : "Customer account"}</Text></View></View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Text style={[styles.detailLabel, { color: colors.muted }]}>RELATIONSHIP ACTIVITY</Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{statusMoment}</Text>
      <Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 11, marginTop: 3 }}>Added {customerActivityDate(customer.created_at)} · Updated {customerActivityDate(customer.updated_at)}</Text>
    </View>

    <View style={styles.notesHeading}><NotebookPen color={colors.primary} size={20} /><Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Private notes</Text></View>
    <Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, marginBottom: 10 }}>Visible only to your vendor account. Customers never receive these notes.</Text>
    <Field label="Notes" maxLength={2000} multiline numberOfLines={5} onChangeText={setNotes} style={{ minHeight: 112, textAlignVertical: "top" }} value={notes} />
    {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 12 }}>{error}</Text>}
    <AppButton disabled={saving || notes.trim() === (customer.vendor_notes || "")} onPress={() => void saveNotes()}>{saving ? "Saving…" : "Save notes"}</AppButton>

    <CustomerMeasurements relationshipId={customer.id} declined={customer.status === "declined"} />
    <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 26 }]}>Coming next</Text>
    <View style={[styles.upcoming, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      <ReceiptIndianRupee color={colors.muted} size={21} />
      <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>Standalone invoices</Text><Text style={[styles.upcomingCopy, { color: colors.muted }]}>Customer invoice drafts and PDFs are coming in a later release.</Text></View>
    </View>
  </Screen>
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", borderRadius: 99, height: 64, justifyContent: "center", width: 64 },
  detailLabel: { fontFamily: "Manrope_700Bold", fontSize: 10, letterSpacing: 0.7 },
  detailRow: { alignItems: "flex-start", flexDirection: "row", gap: 11 },
  detailValue: { fontFamily: "Manrope_600SemiBold", fontSize: 13, lineHeight: 20, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  hero: { alignItems: "center", borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 14, padding: 17 },
  notesHeading: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 7, marginTop: 24 },
  panel: { borderRadius: 18, borderWidth: 1, padding: 16 },
  sectionTitle: { fontFamily: "Fraunces_700Bold", fontSize: 21, marginBottom: 11, marginTop: 22 },
  statusCard: { alignItems: "flex-start", borderRadius: 16, flexDirection: "row", gap: 10, marginTop: 11, padding: 14 },
  upcoming: { alignItems: "flex-start", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 9, padding: 15 },
  upcomingCopy: { fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, marginTop: 3 },
})
