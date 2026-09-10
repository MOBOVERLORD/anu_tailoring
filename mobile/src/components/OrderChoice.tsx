import { useState } from "react"
import { Modal, Pressable, ScrollView, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { AppButton } from "./ui"
import { useTheme } from "@/theme/theme"

export function OrderChoice({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const { colors } = useTheme()
  return <View style={{ gap: 6 }}><Text style={{ color: colors.text }}>{label}</Text><AppButton disabled={disabled} variant="secondary" onPress={() => setOpen(true)}>{options.find((item) => item.value === value)?.label || "Select…"}</AppButton>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}><SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}><Text style={{ color: colors.text, fontSize: 22, marginBottom: 16 }}>{label}</Text><ScrollView keyboardShouldPersistTaps="handled">{options.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ selected: item.value === value }} onPress={() => { onChange(item.value); setOpen(false) }} style={{ padding: 16, borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ color: colors.text }}>{item.value === value ? "✓ " : ""}{item.label}</Text></Pressable>)}</ScrollView><AppButton variant="secondary" onPress={() => setOpen(false)}>Cancel</AppButton></SafeAreaView></Modal>
  </View>
}
