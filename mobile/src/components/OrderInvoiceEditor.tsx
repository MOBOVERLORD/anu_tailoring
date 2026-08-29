import { useMemo, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Plus, Send, Trash2, X } from "lucide-react-native"
import { api } from "@/lib/api"
import type { Order, OrderItem } from "@/types/api"
import { AppButton, Field } from "@/components/ui"
import { useTheme } from "@/theme/theme"

interface DraftLine { name: string; description: string; quantity: number; unit_price: number }

const amount = (value: string, maximum = 1_000_000) => Math.min(maximum, Math.max(0, Number(value.replace(/[^0-9.]/g, "")) || 0))

export const OrderInvoiceEditor = ({ order, item, onClose, onUpdated }: { order: Order; item?: OrderItem; onClose: () => void; onUpdated: (order: Order) => void }) => {
  const { colors } = useTheme()
  const combined = order.combined_order && !item
  const existing = combined ? order.invoice : item?.invoice
  const customerProvidesCloth = existing?.cloth_source === "customer_provided" || (!existing && (combined ? order.order_items.every((entry) => entry.cloth_source === "customer_provided") : item?.cloth_source === "customer_provided"))
  const [serviceAmount, setServiceAmount] = useState(existing?.service_amount || (combined ? order.service_amount : item?.price || 0))
  const [clothType, setClothType] = useState(existing?.cloth_type || item?.fabric_choice || "")
  const [requirement, setRequirement] = useState(existing?.cloth_requirement || "")
  const [clothCost, setClothCost] = useState(customerProvidesCloth ? 0 : existing?.cloth_cost || 0)
  const [lines, setLines] = useState<DraftLine[]>(existing?.line_items.map((line) => ({ name: line.name, description: line.description || "", quantity: line.quantity, unit_price: line.unit_price })) || [])
  const [busy, setBusy] = useState<"draft" | "send" | null>(null)
  const [error, setError] = useState("")
  const customService = combined ? order.order_items.some((entry) => entry.design.is_custom_request_template) : Boolean(item?.design.is_custom_request_template)
  const additional = useMemo(() => lines.reduce((total, line) => total + line.quantity * line.unit_price, 0), [lines])
  const total = serviceAmount + clothCost + additional

  const patchLine = (index: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  const save = async (issue: boolean) => {
    setError("")
    if (clothType.trim().length < 2) return setError("Add the required cloth or fabric type.")
    if (requirement.trim().length < 10) return setError("Describe the cloth requirement in at least 10 characters.")
    if (lines.some((line) => line.name.trim().length < 2 || line.quantity <= 0)) return setError("Complete or remove each additional invoice item.")
    setBusy(issue ? "send" : "draft")
    try {
      const body = JSON.stringify({
        expected_revision: existing?.revision ?? null,
        service_amount: customService || combined ? serviceAmount : null,
        cloth_type: clothType.trim(),
        cloth_requirement: requirement.trim(),
        cloth_cost: customerProvidesCloth ? 0 : clothCost,
        line_items: lines.map((line) => ({ name: line.name.trim(), description: line.description.trim() || null, quantity: line.quantity, unit_price: line.unit_price })),
      })
      const savePath = combined ? `/api/orders/vendor/${order.id}/invoice` : `/api/orders/vendor/items/${item!.id}/invoice`
      const issuePath = combined ? `/api/orders/vendor/${order.id}/invoice/issue` : `/api/orders/vendor/items/${item!.id}/invoice/issue`
      await api(savePath, { method: "PUT", body })
      if (issue) await api(issuePath, { method: "POST" })
      onUpdated(await api<Order>(`/api/orders/${order.id}`))
      onClose()
    } catch (value) { setError((value as Error).message) }
    finally { setBusy(null) }
  }

  return <Modal animationType="slide" onRequestClose={onClose} transparent visible>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 25 }}>{existing ? "Edit invoice" : "Create invoice"}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 19, marginTop: 3 }}>Delivery is calculated separately. Add tailoring, cloth, and agreed material charges.</Text></View><Pressable accessibilityLabel="Close invoice" onPress={onClose} style={[styles.close, { borderColor: colors.border }]}><X color={colors.text} size={20} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.notice, { backgroundColor: colors.primarySoft }]}><Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold" }}>{customerProvidesCloth ? "Customer provides the cloth" : "Vendor provides the cloth"}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, marginTop: 3 }}>{customerProvidesCloth ? "Cloth cost stays at ₹0, but the exact requirement is mandatory." : "Quote the cloth cost; proof can be attached after approval."}</Text></View>
          <Field editable={customService || combined} keyboardType="decimal-pad" label="Tailoring service charge (₹)" maxLength={10} onChangeText={(value) => setServiceAmount(amount(value))} value={String(serviceAmount || "")} />
          <Field label="Required cloth / fabric" maxLength={150} onChangeText={setClothType} placeholder="44-inch cotton-silk, matching lining" value={clothType} />
          <Field label="Cloth requirement from measurements" maxLength={2000} multiline numberOfLines={5} onChangeText={setRequirement} placeholder="3.5 metres of main fabric plus 1 metre lining…" style={{ minHeight: 110, textAlignVertical: "top" }} value={requirement} />
          <Field editable={!customerProvidesCloth} keyboardType="decimal-pad" label="Cloth cost (₹)" maxLength={10} onChangeText={(value) => setClothCost(amount(value))} value={String(customerProvidesCloth ? 0 : clothCost || "")} />
          <View style={styles.sectionTitle}><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>Additional products and costs</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 17 }}>Lining, buttons, zips, accessories, or special finishing.</Text></View><Pressable disabled={lines.length >= 10} onPress={() => setLines((current) => [...current, { name: "", description: "", quantity: 1, unit_price: 0 }])} style={[styles.add, { borderColor: colors.border }]}><Plus color={colors.text} size={17} /><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold", fontSize: 12 }}>Add</Text></Pressable></View>
          {lines.map((line, index) => <View key={index} style={[styles.line, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.lineHeader}><Text style={{ color: colors.text, fontFamily: "Manrope_700Bold" }}>Item {index + 1}</Text><Pressable accessibilityLabel={`Remove item ${index + 1}`} onPress={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 color={colors.danger} size={18} /></Pressable></View><Field label="Product or charge" maxLength={150} onChangeText={(value) => patchLine(index, { name: value })} value={line.name} /><Field label="Description (optional)" maxLength={500} onChangeText={(value) => patchLine(index, { description: value })} value={line.description} /><View style={styles.numericRow}><View style={{ flex: 1 }}><Field keyboardType="decimal-pad" label="Quantity" maxLength={8} onChangeText={(value) => patchLine(index, { quantity: amount(value, 10_000) })} value={String(line.quantity || "")} /></View><View style={{ flex: 1 }}><Field keyboardType="decimal-pad" label="Unit cost (₹)" maxLength={10} onChangeText={(value) => patchLine(index, { unit_price: amount(value) })} value={String(line.unit_price || "")} /></View></View></View>)}
          <View style={[styles.total, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontFamily: "Manrope_600SemiBold" }}>Invoice total</Text><Text style={{ color: colors.primary, fontFamily: "Fraunces_700Bold", fontSize: 27 }}>₹{total.toLocaleString("en-IN")}</Text></View>
          {!!error && <Text style={{ color: colors.danger, fontFamily: "Manrope_600SemiBold", lineHeight: 20, marginBottom: 12 }}>{error}</Text>}
          <View style={styles.actions}><View style={{ flex: 1 }}><AppButton disabled={Boolean(busy)} onPress={() => void save(false)} variant="secondary">{busy === "draft" ? "Saving…" : "Save draft"}</AppButton></View><View style={{ flex: 1 }}><AppButton disabled={Boolean(busy)} onPress={() => void save(true)}><Send color={colors.white} size={16} />{busy === "send" ? "Sending…" : "Save & send"}</AppButton></View></View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,.56)", flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, maxHeight: "94%", overflow: "hidden" },
  header: { alignItems: "flex-start", borderBottomWidth: 1, flexDirection: "row", gap: 12, padding: 18 },
  close: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  content: { padding: 18, paddingBottom: 36 },
  notice: { borderRadius: 16, marginBottom: 17, padding: 14 },
  sectionTitle: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 12 },
  add: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 40, paddingHorizontal: 12 },
  line: { borderRadius: 17, borderWidth: 1, marginBottom: 12, padding: 13 },
  lineHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  numericRow: { flexDirection: "row", gap: 10 },
  total: { alignItems: "center", borderBottomWidth: 1, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginVertical: 17, paddingVertical: 15 },
  actions: { flexDirection: "row", gap: 9 },
})
