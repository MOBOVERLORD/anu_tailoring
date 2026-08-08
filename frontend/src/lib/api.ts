import type { UserProfile } from "@/types/api"

const AUTH_EVENT = "vastrivo-auth-change"
const UI_REQUEST_HEADER = "VastrivoUI"
const REFRESH_EARLY_MS = 60_000
const RECENT_ACTIVITY_MS = 5 * 60_000

let refreshTimer: number | undefined
let refreshPromise: Promise<string> | null = null
let currentUserCache: UserProfile | undefined
let currentUserPromise: Promise<UserProfile> | null = null
const inFlightGets = new Map<string, Promise<unknown>>()
let lastUserActivityAt = Date.now()

export function getAccessToken() {
  return sessionStorage.getItem("access_token")
}

function tokenExpiry(accessToken: string): number | null {
  try {
    const encoded = accessToken.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")
    const payload = JSON.parse(atob(encoded)) as { exp?: number }
    return payload.exp ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function scheduleRefresh(accessToken: string) {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  const expiry = tokenExpiry(accessToken)
  if (!expiry) return
  const delay = Math.max(1_000, expiry - Date.now() - REFRESH_EARLY_MS)
  refreshTimer = window.setTimeout(() => {
    const recentlyActive = Date.now() - lastUserActivityAt <= RECENT_ACTIVITY_MS
    if (document.visibilityState !== "visible" || !recentlyActive) return
    void refreshAccessToken().catch(() => endBrowserSession(true))
  }, delay)
}

export function setSession(accessToken: string) {
  sessionStorage.setItem("access_token", accessToken)
  // Remove refresh tokens created by older versions of the application.
  localStorage.removeItem("refresh_token")
  localStorage.removeItem("access_token")
  scheduleRefresh(accessToken)
  window.dispatchEvent(new Event(AUTH_EVENT))
}

function endBrowserSession(redirect: boolean) {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = undefined
  sessionStorage.removeItem("access_token")
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
  currentUserCache = undefined
  currentUserPromise = null
  inFlightGets.clear()
  window.dispatchEvent(new Event(AUTH_EVENT))
  if (redirect && window.location.pathname !== "/login") window.location.replace("/login")
}

export function clearSession() {
  endBrowserSession(false)
}

export function onAuthChange(listener: () => void) {
  window.addEventListener(AUTH_EVENT, listener)
  window.addEventListener("storage", listener)
  return () => {
    window.removeEventListener(AUTH_EVENT, listener)
    window.removeEventListener("storage", listener)
  }
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": UI_REQUEST_HEADER },
    })
    if (!response.ok) throw new Error("Your session has expired. Please sign in again.")
    const data = await response.json() as { access_token: string }
    setSession(data.access_token)
    return data.access_token
  })().finally(() => { refreshPromise = null })
  return refreshPromise
}

async function fetchWithToken(path: string, options: RequestInit, token: string | null) {
  const isFormData = options.body instanceof FormData
  return fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      "X-Requested-With": UI_REQUEST_HEADER,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}

async function request(path: string, options: RequestInit = {}) {
  const token = getAccessToken()
  let response = await fetchWithToken(path, options, token)
  const doesNotRefresh = [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
  ].includes(path) || path.startsWith("/api/auth/password-reset/")

  if (response.status === 401 && token && !doesNotRefresh) {
    try {
      const newAccessToken = await refreshAccessToken()
      response = await fetchWithToken(path, options, newAccessToken)
    } catch {
      endBrowserSession(true)
      throw new Error("Your session has expired. Please sign in again.")
    }
  }

  if (!response.ok) {
    let message = "Something went wrong"
    try {
      const error = await response.json() as { detail?: string | Array<{ msg: string }> }
      message = Array.isArray(error.detail)
        ? error.detail.map((item) => item.msg).join(", ")
        : error.detail || message
    } catch {
      // Keep the friendly fallback for non-JSON server errors.
    }
    throw new Error(message)
  }

  return response
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase()
  if (method === "GET" && !options.body) {
    const existing = inFlightGets.get(path)
    if (existing) return existing as Promise<T>
    const pending = (async () => {
      const response = await request(path, options)
      if (response.status === 204) return undefined as T
      return response.json() as Promise<T>
    })().finally(() => inFlightGets.delete(path))
    inFlightGets.set(path, pending)
    return pending
  }
  const response = await request(path, options)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function getCurrentUser(force = false): Promise<UserProfile> {
  if (!force && currentUserCache) return Promise.resolve(currentUserCache)
  if (!force && currentUserPromise) return currentUserPromise
  currentUserPromise = api<UserProfile>("/api/auth/me")
    .then((profile) => {
      currentUserCache = profile
      return profile
    })
    .finally(() => { currentUserPromise = null })
  return currentUserPromise
}

export function updateCurrentUserCache(profile: UserProfile) {
  currentUserCache = profile
}

export async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const response = await request(path, options)
  return response.blob()
}

export async function closeSession() {
  try {
    await request("/api/auth/logout", { method: "POST" })
  } catch {
    // Always close the local session; the server session will expire shortly
    // if it cannot be reached during logout.
  } finally {
    endBrowserSession(false)
  }
}

const existingAccessToken = getAccessToken()
if (existingAccessToken) scheduleRefresh(existingAccessToken)
// Access tokens from older builds were persistent across browser restarts.
// Remove them instead of silently restoring a session in the new model.
localStorage.removeItem("access_token")
localStorage.removeItem("refresh_token")

const recordUserActivity = () => { lastUserActivityAt = Date.now() }
window.addEventListener("pointerdown", recordUserActivity, { passive: true })
window.addEventListener("keydown", recordUserActivity, { passive: true })
window.addEventListener("scroll", recordUserActivity, { passive: true })
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") recordUserActivity()
})
