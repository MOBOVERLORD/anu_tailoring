import "react-native-gesture-handler"
import { useFonts as useManrope, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope"
import { useFonts as useFraunces, Fraunces_700Bold } from "@expo-google-fonts/fraunces"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { ActivityIndicator, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { SessionProvider } from "@/auth/SessionProvider"
import { ThemeProvider, useTheme } from "@/theme/theme"

const Navigation = () => {
  const { colors, dark } = useTheme()
  return <>
    <StatusBar style={dark ? "light" : "dark"} />
    <Stack screenOptions={{ animation: "slide_from_right", contentStyle: { backgroundColor: colors.background }, headerShown: false }} />
  </>
}

export default function RootLayout() {
  const [manropeLoaded] = useManrope({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold })
  const [frauncesLoaded] = useFraunces({ Fraunces_700Bold })
  if (!manropeLoaded || !frauncesLoaded) return <View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}><ActivityIndicator color="#B84F2E" /></View>
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><ThemeProvider><SessionProvider><Navigation /></SessionProvider></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>
}
