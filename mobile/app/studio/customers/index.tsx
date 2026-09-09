import { useCallback, useEffect, useRef, useState } from "react"
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { ChevronRight, Mail, Plus, Search, UserPlus, UsersRound, X } from "lucide-react-native"
import { type Href, useFocusEffect, useRouter } from "expo-router"

import { AppButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Pill, Screen } from "@/components/ui"
import { api } from "@/lib/api"
import { customerActivityDate, customerStatusLabel, customerStatusTone } from "@/lib/vendorCustomers"
import { useTheme } from "@/theme/theme"
import type { VendorCustomerRelationship, VendorCustomerRelationshipPage, VendorCustomerStatus } from "@/types/api"

const PAGE_SIZE = 20
type CustomerFilter = "all" | VendorCustomerStatus
type AddMode = "link" | "invite"

const filters: Array<{ label: string; value: CustomerFilter }> = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Invited", value: "invited" },
  { label: "Awaiting", value: "pending_acceptance" },
  { label: "Declined", value: "declined" },
]

const AddCustomerModal = ({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (customer: VendorCustomerRelationship) => Promise<void>
}) => {
  const { colors } = useTheme()
  const [mode, setMode] = useState<AddMode>("link")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    const phoneDigits = phone.replace(/\D/g, "")
    if (!normalizedEmail.includes("@") || phoneDigits.length < 10) {
      setError("Enter the account's exact email address and phone number.")
      return
    }
    if (mode === "invite" && fullName.trim().length < 2) {
      setError("Enter the customer's full name.")
      return
    }

    setSaving(true)
    setError("")
    try {
      const payload = {
        ...(mode === "invite" ? { full_name: fullName.trim() } : {}),
        email: normalizedEmail,
        phone: phone.trim(),
        vendor_notes: notes.trim() || null,
      }
      const customer = await api<VendorCustomerRelationship>(`/api/vendor/customers/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      await onSaved(customer)
    } catch (value) {
      setError((value as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
    <View style={[styles.modal, { backgroundColor: colors.background }]}>
      <View style={styles.modalHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Add customer</Text>
          <Text style={{ color: colors.muted, lineHeight: 19, marginTop: 3 }}>Link an exact account or invite someone new.</Text>
        </View>
        <Pressable accessibilityLabel="Close" disabled={saving} onPress={onClose} style={[styles.close, { borderColor: colors.border }]}>
          <X color={colors.text} size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={[styles.modePicker, { backgroundColor: colors.surfaceMuted }]}>
          {(["link", "invite"] as AddMode[]).map((item) => <Pressable
            accessibilityRole="button"
            key={item}
            onPress={() => { setMode(item); setError("") }}
            style={[styles.mode, { backgroundColor: mode === item ? colors.surface : "transparent", borderColor: mode === item ? colors.border : "transparent" }]}
          ><Text style={{ color: mode === item ? colors.text : colors.muted, fontFamily: "Manrope_700Bold" }}>{item === "link" ? "Existing account" : "Invite new"}</Text></Pressable>)}
        </View>
        <View style={[styles.guidance, { backgroundColor: colors.primarySoft }]}>
          {mode === "link" ? <UsersRound color={colors.primary} size={21} /> : <Mail color={colors.primary} size={21} />}
          <Text style={{ color: colors.text, flex: 1, fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18 }}>
            {mode === "link" ? "Both values must exactly match the same active account. The customer will be asked to approve the relationship." : "A customer-only account is created and a secure password-setup link is emailed to them."}
          </Text>
        </View>
        {mode === "invite" && <Field autoCapitalize="words" label="Full name" maxLength={100} onChangeText={setFullName} value={fullName} />}
        <Field autoCapitalize="none" autoCorrect={false} keyboardType="email-address" label="Email address" maxLength={254} onChangeText={setEmail} value={email} />
        <Field keyboardType="phone-pad" label="Phone number" maxLength={20} onChangeText={setPhone} placeholder="+91 98765 43210" value={phone} />
        <Field label="Private notes (optional)" maxLength={2000} multiline numberOfLines={4} onChangeText={setNotes} style={{ minHeight: 100, textAlignVertical: "top" }} value={notes} />
        {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 14 }}>{error}</Text>}
        <AppButton disabled={saving} onPress={() => void save()}>
          <UserPlus color={colors.white} size={18} />
          {saving ? "Saving…" : mode === "link" ? "Link account" : "Send invitation"}
        </AppButton>
      </ScrollView>
    </View>
  </Modal>
}

export default function StudioCustomersScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const requestNumber = useRef(0)
  const [customers, setCustomers] = useState<VendorCustomerRelationship[]>([])
  const [total, setTotal] = useState(0)
  const [queryInput, setQueryInput] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<CustomerFilter>("all")
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [queryInput])

  const load = useCallback(async (offset = 0, append = false) => {
    const currentRequest = ++requestNumber.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError("")
    try {
      const parameters = [
        `limit=${PAGE_SIZE}`,
        `offset=${offset}`,
        ...(query ? [`query=${encodeURIComponent(query)}`] : []),
        ...(filter !== "all" ? [`status=${filter}`] : []),
      ].join("&")
      const response = await api<VendorCustomerRelationshipPage>(`/api/vendor/customers?${parameters}`)
      if (currentRequest !== requestNumber.current) return
      setCustomers((current) => append ? [...current, ...response.items] : response.items)
      setTotal(response.total)
    } catch (value) {
      if (currentRequest === requestNumber.current) setError((value as Error).message)
    } finally {
      if (currentRequest === requestNumber.current) {
        setLoading(false)
        setLoadingMore(false)
        setRefreshing(false)
      }
    }
  }, [filter, query])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const openCustomer = (customer: VendorCustomerRelationship) => router.push(`/studio/customers/${customer.id}` as Href)

  const customerSaved = async (customer: VendorCustomerRelationship) => {
    await load()
    setAdding(false)
    openCustomer(customer)
  }

  return <Screen scroll={false}>
    <PageHeader
      action={<Pressable accessibilityLabel="Add customer" onPress={() => setAdding(true)} style={[styles.add, { backgroundColor: colors.primary }]}><Plus color={colors.white} size={22} /></Pressable>}
      back
      subtitle="Linked accounts and secure customer invitations for your shop."
      title="Customers"
    />
    <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Search color={colors.muted} size={18} />
      <TextInput
        accessibilityLabel="Search customers"
        autoCapitalize="none"
        onChangeText={setQueryInput}
        placeholder="Name, exact email or phone"
        placeholderTextColor={colors.muted}
        style={[styles.searchInput, { color: colors.text }]}
        value={queryInput}
      />
    </View>
    <ScrollView contentContainerStyle={styles.filters} horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
      {filters.map((item) => <Pressable key={item.value} onPress={() => setFilter(item.value)} style={[styles.filter, { backgroundColor: filter === item.value ? colors.primary : colors.surface, borderColor: filter === item.value ? colors.primary : colors.border }]}>
        <Text numberOfLines={1} style={[styles.filterText, { color: filter === item.value ? colors.white : colors.text }]}>{item.label}</Text>
      </Pressable>)}
    </ScrollView>
    {loading ? <LoadingState label="Loading customers…" /> : error && !customers.length ? <ErrorState message={error} retry={() => void load()} /> : <>
      {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", marginBottom: 10 }}>{error}</Text>}
      <FlatList
        contentContainerStyle={styles.list}
        data={customers}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={<EmptyState message={query || filter !== "all" ? "Try another search or relationship status." : "Link an existing account or send your first customer invitation."} title={query || filter !== "all" ? "No matching customers" : "No customers yet"} />}
        ListFooterComponent={loadingMore ? <View style={styles.loadingMore}><Text style={{ color: colors.muted, fontFamily: "Manrope_600SemiBold" }}>Loading more…</Text></View> : null}
        onEndReached={() => { if (!loadingMore && customers.length < total) void load(customers.length, true) }}
        onEndReachedThreshold={0.35}
        refreshControl={<RefreshControl onRefresh={() => { setRefreshing(true); void load() }} refreshing={refreshing} tintColor={colors.primary} />}
        renderItem={({ item }) => <Pressable onPress={() => openCustomer(item)} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}><Text style={{ color: colors.primary, fontFamily: "Fraunces_700Bold", fontSize: 20 }}>{item.full_name.trim().charAt(0).toUpperCase()}</Text></View>
          <View style={styles.cardCopy}>
            <View style={styles.cardTitleRow}><Text numberOfLines={1} style={{ color: colors.text, flex: 1, fontFamily: "Fraunces_700Bold", fontSize: 18 }}>{item.full_name}</Text><Pill tone={customerStatusTone(item.status)}>{customerStatusLabel(item.status)}</Pill></View>
            <Text numberOfLines={1} style={{ color: colors.text, fontFamily: "Manrope_500Medium", fontSize: 12, marginTop: 5 }}>{item.email}</Text>
            <Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 11, marginTop: 3 }}>{item.phone || "No phone"} · Updated {customerActivityDate(item.updated_at)}</Text>
          </View>
          <ChevronRight color={colors.muted} size={19} />
        </Pressable>}
      />
    </>}
    {adding && <AddCustomerModal onClose={() => setAdding(false)} onSaved={customerSaved} />}
  </Screen>
}

const styles = StyleSheet.create({
  add: { alignItems: "center", borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  avatar: { alignItems: "center", borderRadius: 99, height: 48, justifyContent: "center", width: 48 },
  card: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, padding: 14 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  close: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  filter: { alignItems: "center", borderRadius: 99, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 13 },
  filterScroll: { flexGrow: 0, marginBottom: 12 },
  filters: { alignItems: "center", gap: 8, minHeight: 44, paddingRight: 4 },
  filterText: { fontFamily: "Manrope_700Bold", fontSize: 12, lineHeight: 18 },
  form: { padding: 20, paddingBottom: 42 },
  guidance: { alignItems: "flex-start", borderRadius: 16, flexDirection: "row", gap: 10, marginBottom: 19, padding: 14 },
  list: { gap: 10, paddingBottom: 34 },
  loadingMore: { alignItems: "center", padding: 18 },
  modal: { flex: 1 },
  modalHeader: { alignItems: "flex-start", borderBottomColor: "rgba(128,128,128,.25)", borderBottomWidth: 1, flexDirection: "row", gap: 14, padding: 20, paddingTop: 24 },
  modalTitle: { fontFamily: "Fraunces_700Bold", fontSize: 28 },
  mode: { alignItems: "center", borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 43, justifyContent: "center", paddingHorizontal: 8 },
  modePicker: { borderRadius: 15, flexDirection: "row", gap: 5, marginBottom: 14, padding: 4 },
  search: { alignItems: "center", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 7, marginBottom: 10, paddingHorizontal: 13 },
  searchInput: { flex: 1, fontFamily: "Manrope_500Medium", fontSize: 15, minHeight: 48, paddingHorizontal: 0, paddingVertical: 10 },
})
