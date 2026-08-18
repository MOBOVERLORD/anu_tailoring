import { Image, Pressable, StyleSheet, Text, View } from "react-native"
import { ImageIcon } from "lucide-react-native"
import { absoluteUrl, currentAccessToken } from "@/lib/api"
import { useTheme } from "@/theme/theme"

export const CatalogCard = ({ title, imageUrl, eyebrow, price, onPress }: { title: string; imageUrl: string | null; eyebrow: string; price?: number; onPress: () => void }) => {
  const { colors } = useTheme()
  const token = currentAccessToken()
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}>
    <View style={[styles.imageWrap, { backgroundColor: colors.surfaceMuted }]}>
      {imageUrl ? <Image resizeMode="cover" source={{ uri: absoluteUrl(imageUrl), headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={styles.image} /> : <ImageIcon color={colors.muted} size={36} />}
    </View>
    <View style={styles.copy}>
      <Text numberOfLines={1} style={{ color: colors.primary, fontFamily: "Manrope_700Bold", fontSize: 10, textTransform: "uppercase" }}>{eyebrow}</Text>
      <Text numberOfLines={2} style={{ color: colors.text, fontFamily: "Fraunces_700Bold", fontSize: 17, lineHeight: 20, marginTop: 5 }}>{title}</Text>
      {price !== undefined && <Text style={{ color: colors.primary, fontFamily: "Manrope_700Bold", fontSize: 13, marginTop: 9 }}>From ₹{price.toLocaleString("en-IN")}</Text>}
    </View>
  </Pressable>
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, flex: 1, margin: 5, overflow: "hidden" },
  imageWrap: { alignItems: "center", aspectRatio: 0.82, justifyContent: "center", overflow: "hidden", width: "100%" },
  image: { height: "100%", width: "100%" },
  copy: { minHeight: 104, padding: 12 },
})
