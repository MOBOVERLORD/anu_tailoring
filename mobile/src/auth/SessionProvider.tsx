import * as Application from "expo-application"
import * as Device from "expo-device"
import { useRouter, useSegments } from "expo-router"
import { Platform } from "react-native"
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { api, clearMobileSession, currentAccessToken, getDeviceId, mobileLoginRequest, restoreMobileSession, SessionRejectedError, setAuthFailureHandler } from "@/lib/api"
import type { UserProfile } from "@/types/api"

interface RegisterInput {
  full_name: string
  email: string
  phone: string
  password: string
}

interface SessionValue {
  profile: UserProfile | null
  accessToken: string | null
  loading: boolean
  startupError: string | null
  retryStartup: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  reloadProfile: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export const SessionProvider = ({ children }: PropsWithChildren) => {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [startupError, setStartupError] = useState<string | null>(null)
  const router = useRouter()
  const segments = useSegments()

  const loadProfile = useCallback(async () => {
    const next = await api<UserProfile>("/api/auth/me")
    setProfile(next)
  }, [])

  const endSession = useCallback(() => {
    setProfile(null)
  }, [])

  const retryStartup = useCallback(async () => {
    setLoading(true)
    setStartupError(null)
    try {
      await restoreMobileSession()
      await loadProfile()
    } catch (error) {
      if (error instanceof SessionRejectedError) endSession()
      else setStartupError("Unable to restore your session right now. Check your connection and retry. Your saved login has been kept.")
    } finally { setLoading(false) }
  }, [endSession, loadProfile])

  useEffect(() => {
    setAuthFailureHandler(endSession)
    void retryStartup()
    return () => setAuthFailureHandler(null)
  }, [endSession, retryStartup])

  useEffect(() => {
    if (loading || startupError) return
    const inAuth = segments[0] === "(auth)"
    if (!profile && !inAuth) router.replace("/(auth)/login")
    if (profile && inAuth) router.replace("/(tabs)/designs")
  }, [loading, startupError, profile, router, segments])

  const login = async (email: string, password: string) => {
    await mobileLoginRequest({
      email,
      password,
      device_id: await getDeviceId(),
      device_name: Device.deviceName || Device.modelName || `${Platform.OS} device`,
      platform: Platform.OS === "ios" ? "ios" : "android",
      app_version: Application.nativeApplicationVersion || "0.1.0",
    })
    await loadProfile()
  }

  const register = async (input: RegisterInput) => {
    await api<UserProfile>("/api/auth/register", { method: "POST", body: JSON.stringify(input) })
    await login(input.email, input.password)
  }

  const logout = async () => {
    try {
      await restoreMobileSession()
      await api<void>("/api/auth/mobile/logout", { method: "POST" }, false)
    } finally {
      await clearMobileSession()
      setProfile(null)
    }
  }

  const value = useMemo<SessionValue>(() => ({
    profile,
    accessToken: currentAccessToken(),
    loading,
    startupError,
    retryStartup,
    login,
    register,
    logout,
    reloadProfile: loadProfile,
  }), [loading, loadProfile, profile, startupError, retryStartup])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside SessionProvider")
  return value
}
