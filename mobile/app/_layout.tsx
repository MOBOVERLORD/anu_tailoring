import "react-native-gesture-handler"
import { useEffect } from "react"
import * as SplashScreen from "expo-splash-screen"
import * as SystemUI from "expo-system-ui"
import { useFonts as useManrope, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope"
import { useFonts as useFraunces, Fraunces_700Bold } from "@expo-google-fonts/fraunces"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { SessionProvider, useSession } from "@/auth/SessionProvider"
import { ThemeProvider, useTheme } from "@/theme/theme"

void SplashScreen.preventAutoHideAsync().catch(() => undefined)

const Navigation = () => {
  const { colors, dark } = useTheme()
  const { loading, startupError, retryStartup } = useSession()
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined)
    void SplashScreen.hideAsync().catch(() => undefined)
  }, [colors.background])
  return <>
    <StatusBar style={dark ? "light" : "dark"} />
    <Stack screenOptions={{ animation: "slide_from_right", contentStyle: { backgroundColor: colors.background }, headerShown: false }} />
    {(loading || startupError) && <View style={{ position: "absolute", inset: 0, backgroundColor: colors.background, justifyContent: "center", padding: 32, gap: 20 }} accessibilityViewIsModal>
      {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Restoring session" /> : <>
        <Text accessibilityRole="alert" style={{ color: colors.text, fontSize: 17 }}>{startupError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void retryStartup()} style={{ padding: 16, backgroundColor: colors.primary, borderRadius: 12 }}><Text style={{ color: colors.white, textAlign: "center" }}>Retry connection</Text></Pressable>
      </>}
    </View>}
  </>
}

function ReadyApp() {
  const { ready } = useTheme()
  const [manropeLoaded, manropeError] = useManrope({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold })
  const [frauncesLoaded, frauncesError] = useFraunces({ Fraunces_700Bold })
  if (!ready || (!manropeLoaded && !manropeError) || (!frauncesLoaded && !frauncesError)) return null
  return <SessionProvider><Navigation /></SessionProvider>
}

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><ThemeProvider><ReadyApp /></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>
}
