import * as SecureStore from "expo-secure-store"
import * as Crypto from "expo-crypto"
import type { MobileToken } from "@/types/api"

const UI_HEADER = "VastrivoUI"
const REFRESH_KEY = "vastrivo.mobile.refresh"
const DEVICE_KEY = "vastrivo.mobile.device"
const PENDING_KEY = "vastrivo.mobile.refresh.pending.v1"
const configuredOrigin = process.env.EXPO_PUBLIC_API_URL?.trim()
export const API_ORIGIN = (configuredOrigin || "http://10.0.2.2:8000").replace(/\/$/, "")

let accessToken: string | null = null
let refreshPromise: Promise<string> | null = null
let authFailureHandler: (() => void) | null = null

export class SessionRejectedError extends Error {}

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

export const absoluteUrl = (path: string) => path.startsWith("http") ? path : `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`
export const currentAccessToken = () => accessToken
export const setAuthFailureHandler = (handler: (() => void) | null) => { authFailureHandler = handler }

export const getDeviceId = async () => {
  const stored = await SecureStore.getItemAsync(DEVICE_KEY, secureOptions)
  if (stored) return stored
  const next = Crypto.randomUUID()
  await SecureStore.setItemAsync(DEVICE_KEY, next, secureOptions)
  return next
}

export const saveMobileSession = async (tokens: MobileToken) => {
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token, secureOptions)
  accessToken = tokens.access_token
  // The successor is durable now; stale recovery metadata is no longer needed.
  await SecureStore.deleteItemAsync(PENDING_KEY, secureOptions).catch(() => undefined)
}

export const clearMobileSession = async () => {
  accessToken = null
  await Promise.all([SecureStore.deleteItemAsync(REFRESH_KEY, secureOptions), SecureStore.deleteItemAsync(PENDING_KEY, secureOptions)])
}

const messageFrom = async (response: Response) => {
  try {
    const value = await response.json() as { detail?: string | Array<{ msg?: string }> }
    if (Array.isArray(value.detail)) return value.detail.map((item) => item.msg).filter(Boolean).join(", ")
    return value.detail || "Something went wrong"
  } catch {
    return "Something went wrong"
  }
}

export const refreshMobileSession = async (): Promise<string> => {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY, secureOptions)
    if (!refreshToken) throw new SessionRejectedError("Please sign in.")
    const saved = await SecureStore.getItemAsync(PENDING_KEY, secureOptions)
    let pending: { token: string; id: string } | null = null
    try { pending = saved ? JSON.parse(saved) : null } catch { /* Replace corrupt pending metadata. */ }
    if (!pending || pending.token !== refreshToken || typeof pending.id !== "string" || pending.id.length < 32) {
      pending = { token: refreshToken, id: Crypto.randomUUID() }
      // Persist before dispatch so process death and lost responses use the same request.
      await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending), secureOptions)
    }
    const response = await fetch(absoluteUrl("/api/auth/mobile/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": UI_HEADER },
      body: JSON.stringify({ refresh_token: refreshToken, device_id: await getDeviceId(), request_id: pending.id }),
    })
    if (!response.ok) {
      const message = await messageFrom(response)
      if (response.status === 401) {
        await clearMobileSession()
        throw new SessionRejectedError(message)
      }
      throw new Error(message)
    }
    const tokens = await response.json() as MobileToken
    await saveMobileSession(tokens)
    return tokens.access_token
  })().finally(() => { refreshPromise = null })
  return refreshPromise
}

export const restoreMobileSession = async () => refreshMobileSession()

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData
  const response = await fetch(absoluteUrl(path), {
    ...init,
    headers: {
      ...(!isFormData && init.body ? { "Content-Type": "application/json" } : {}),
      "X-Requested-With": UI_HEADER,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  })
  if (response.status === 401 && retry && accessToken && !path.startsWith("/api/auth/mobile/")) {
    try {
      await refreshMobileSession()
    } catch (error) {
      if (error instanceof SessionRejectedError) authFailureHandler?.()
      throw error
    }
    return api<T>(path, init, false)
  }
  if (response.status === 401 && accessToken && !retry && !path.startsWith("/api/auth/mobile/")) {
    await clearMobileSession()
    authFailureHandler?.()
    throw new SessionRejectedError(await messageFrom(response))
  }
  if (!response.ok) throw new Error(await messageFrom(response))
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const mobileLoginRequest = async (payload: Record<string, string>) => {
  const response = await fetch(absoluteUrl("/api/auth/mobile/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": UI_HEADER },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await messageFrom(response))
  const tokens = await response.json() as MobileToken
  await saveMobileSession(tokens)
  return tokens
}
