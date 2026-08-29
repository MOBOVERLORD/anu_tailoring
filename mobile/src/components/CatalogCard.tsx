import { useMemo, useState } from "react"
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { ImageIcon } from "lucide-react-native"
import { absoluteUrl, currentAccessToken } from "@/lib/api"
import { useTheme } from "@/theme/theme"

export const CatalogCard = ({ title, imageUrl, imageUrls, eyebrow, price, onPress }: { title: string; imageUrl?: string | null; imageUrls?: Array<string | null>; eyebrow: string; price?: number; onPress: () => void }) => {
  const { colors } = useTheme()
  const token = currentAccessToken()
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState(0)
  const images = useMemo(() => Array.from(new Set((imageUrls?.length ? imageUrls : [imageUrl]).filter((value): value is string => Boolean(value)))), [imageUrl, imageUrls])
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}>
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.imageWrap, { backgroundColor: colors.surfaceMuted }]}>
      {images.length ? <ScrollView
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={(event) => { if (width) setActive(Math.round(event.nativeEvent.contentOffset.x / width)) }}
        pagingEnabled
        showsHorizontalScrollIndicator={false}
      >{images.map((url, index) => <Image fadeDuration={180} key={`${url}-${index}`} resizeMode="cover" source={{ uri: absoluteUrl(url), headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={[styles.image, width ? { width } : undefined]} />)}</ScrollView> : <ImageIcon color={colors.muted} size={36} />}
      {images.length > 1 && <View style={styles.pageBadge}><Text style={styles.pageBadgeText}>{active + 1}/{images.length}</Text></View>}
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
  pageBadge: { backgroundColor: "rgba(0,0,0,.62)", borderRadius: 99, bottom: 8, left: 8, paddingHorizontal: 7, paddingVertical: 4, position: "absolute" },
  pageBadgeText: { color: "#FFFFFF", fontFamily: "Manrope_700Bold", fontSize: 9 },
  copy: { minHeight: 104, padding: 12 },
})
