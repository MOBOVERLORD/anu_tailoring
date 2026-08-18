import { Tabs } from "expo-router"
import { ClipboardList, Grid2X2, Store, UserRound, WandSparkles } from "lucide-react-native"
import { useSession } from "@/auth/SessionProvider"
import { useTheme } from "@/theme/theme"

export default function TabsLayout() {
  const { colors } = useTheme(); const { profile } = useSession()
  const workspaceLabel = profile?.role === "delivery_agent" ? "Deliveries" : profile?.role === "vendor" ? "Studio" : "Workspace"
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarLabelStyle: { fontFamily: "Manrope_700Bold", fontSize: 10 },
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 70, paddingBottom: 9, paddingTop: 8 },
  }}>
    <Tabs.Screen name="designs" options={{ tabBarIcon: ({ color, size }) => <Grid2X2 color={color} size={size} />, title: "Discover" }} />
    <Tabs.Screen name="vendors" options={{ tabBarIcon: ({ color, size }) => <Store color={color} size={size} />, title: "Vendors" }} />
    <Tabs.Screen name="orders" options={{ tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />, title: "My orders" }} />
    <Tabs.Screen name="workspace" options={{ tabBarIcon: ({ color, size }) => <WandSparkles color={color} size={size} />, title: workspaceLabel }} />
    <Tabs.Screen name="profile" options={{ tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} />, title: "Profile" }} />
  </Tabs>
}
