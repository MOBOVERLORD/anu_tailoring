import { Children, type PropsWithChildren, type ReactNode } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { AlertCircle, ArrowLeft } from "lucide-react-native"
import { useRouter } from "expo-router"
import { useTheme } from "@/theme/theme"

export const Heading = ({ children, size = 30 }: { children: ReactNode; size?: number }) => {
  const { colors } = useTheme()
  return <Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: size, lineHeight: size * 1.14 }}>{children}</Text>
}

export const Label = ({ children }: PropsWithChildren) => {
  const { colors } = useTheme()
  return <Text style={{ color: colors.text, fontFamily: "Manrope_700Bold", fontSize: 13, marginBottom: 7 }}>{children}</Text>
}

export const Field = (props: TextInputProps & { label: string }) => {
  const { colors } = useTheme()
  return <View style={{ marginBottom: 16 }}><Label>{props.label}</Label><TextInput
    {...props}
    placeholderTextColor={colors.muted}
    style={[styles.input, { backgroundColor: props.editable === false ? colors.surfaceMuted : colors.surface, borderColor: colors.border, color: colors.text, opacity: props.editable === false ? 0.72 : 1 }, props.style]}
  /></View>
}

export const AppButton = ({ children, onPress, disabled = false, variant = "primary" }: PropsWithChildren<{ onPress: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" }>) => {
  const { colors } = useTheme()
  const backgroundColor = variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : colors.surface
  const color = variant === "secondary" ? colors.text : colors.white
  return <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor, borderColor: variant === "secondary" ? colors.border : backgroundColor, opacity: disabled ? 0.5 : pressed ? 0.78 : 1 }]}
  ><View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>{Children.map(children, (child) => typeof child === "string" || typeof child === "number" ? <Text style={{ color, fontFamily: "Manrope_700Bold", fontSize: 14 }}>{child}</Text> : child)}</View></Pressable>
}

export const Screen = ({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) => {
  const { colors } = useTheme()
  const content = scroll ? <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
  return <SafeAreaView edges={["top", "left", "right"]} style={{ backgroundColor: colors.background, flex: 1 }}>{content}</SafeAreaView>
}

export const PageHeader = ({ title, subtitle, back = false, action }: { title: string; subtitle?: string; back?: boolean; action?: ReactNode }) => {
  const { colors } = useTheme()
  const router = useRouter()
  return <View style={styles.header}>
    <View style={{ flex: 1 }}>
      {back && <Pressable accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={colors.text} size={22} /></Pressable>}
      <Heading>{title}</Heading>
      {subtitle && <Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 21, marginTop: 5 }}>{subtitle}</Text>}
    </View>
    {action}
  </View>
}

export const LoadingState = ({ label = "Loading…" }: { label?: string }) => {
  const { colors } = useTheme()
  return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={{ color: colors.muted, fontFamily: "Manrope_500Medium", marginTop: 12 }}>{label}</Text></View>
}

export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => {
  const { colors } = useTheme()
  return <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><AlertCircle color={colors.danger} size={28} /><Text style={{ color: colors.text, fontFamily: "Manrope_600SemiBold", marginVertical: 12, textAlign: "center" }}>{message}</Text>{retry && <AppButton onPress={retry} variant="secondary">Try again</AppButton>}</View>
}

export const EmptyState = ({ title, message }: { title: string; message: string }) => {
  const { colors } = useTheme()
  return <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 22 }}>{title}</Text><Text style={{ color: colors.muted, fontFamily: "Manrope_400Regular", lineHeight: 21, marginTop: 8, textAlign: "center" }}>{message}</Text></View>
}

export const Pill = ({ children, tone = "default" }: PropsWithChildren<{ tone?: "default" | "success" | "primary" }>) => {
  const { colors } = useTheme()
  const color = tone === "success" ? colors.success : tone === "primary" ? colors.primary : colors.muted
  return <View style={{ alignSelf: "flex-start", backgroundColor: `${color}18`, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color, fontFamily: "Manrope_700Bold", fontSize: 10, textTransform: "uppercase" }}>{children}</Text></View>
}

const styles = StyleSheet.create({
  screenContent: { padding: 18, paddingBottom: 34 },
  input: { borderRadius: 14, borderWidth: 1, fontFamily: "Manrope_500Medium", fontSize: 16, minHeight: 52, paddingHorizontal: 15, paddingVertical: 13 },
  button: { alignItems: "center", borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12, marginBottom: 22 },
  back: { alignItems: "center", height: 38, justifyContent: "center", marginBottom: 9, marginLeft: -8, width: 38 },
  center: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 320 },
  stateCard: { alignItems: "center", borderRadius: 20, borderWidth: 1, marginTop: 20, padding: 28 },
})
