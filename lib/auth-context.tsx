"use client"

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"
import { type UserPermissions, PERMISSION_PRESETS, DEFAULT_PERMISSIONS } from "@/lib/types"

interface User {
  id: number
  username: string
  role: "admin" | "viewer"
  permissions?: UserPermissions
}

interface AuthContextType {
  user: User | null
  isAdmin: boolean
  isLoading: boolean
  permissions: UserPermissions
  hasPermission: (permission: keyof UserPermissions) => boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = "theia_token"

function getBackendUrl(path: string): string {
  if (typeof window === "undefined") return `/api${path}`
  return `http://${window.location.hostname}:8000/api${path}`
}

/** Get stored auth token -- used by fetch helpers for cross-port requests */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

/** Build auth headers with Bearer token for cross-port requests */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  const token = getAuthToken()
  if (token) headers["Authorization"] = `Bearer ${token}`
  return headers
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(getBackendUrl("/auth/me"), {
        credentials: "include",
        headers: authHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data)
      } else {
        setUser(null)
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(getBackendUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: "Login failed" }))
      throw new Error(data.detail || "Login failed")
    }
    const data = await res.json()
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    const token = getAuthToken()
    await fetch(getBackendUrl("/auth/logout"), {
      method: "POST",
      credentials: "include",
      headers: token ? { "Authorization": `Bearer ${token}` } : {},
    }).catch(() => {})
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  // Compute effective permissions based on user role and custom permissions
  const permissions: UserPermissions = user?.permissions 
    ?? (user?.role === "admin" ? PERMISSION_PRESETS.admin.permissions : DEFAULT_PERMISSIONS)

  const hasPermission = useCallback((permission: keyof UserPermissions): boolean => {
    if (!user) return false
    // Admin role always has all permissions
    if (user.role === "admin" && !user.permissions) return true
    const perms = user.permissions ?? (user.role === "admin" ? PERMISSION_PRESETS.admin.permissions : DEFAULT_PERMISSIONS)
    return perms[permission] ?? false
  }, [user])

  return (
    <AuthContext.Provider value={{
      user,
      isAdmin: user?.role === "admin",
      isLoading,
      permissions,
      hasPermission,
      login,
      logout,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
