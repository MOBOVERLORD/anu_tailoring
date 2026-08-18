import { Redirect } from "expo-router"
import { LoadingState, Screen } from "@/components/ui"
import { useSession } from "@/auth/SessionProvider"

export default function Index() {
  const { loading, profile } = useSession()
  if (loading) return <Screen scroll={false}><LoadingState label="Opening Vastrivo…" /></Screen>
  return <Redirect href={profile ? "/(tabs)/designs" : "/(auth)/login"} />
}
