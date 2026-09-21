"use client"

import { backendOrigin } from "@/lib/backend"
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
  return `${backendOrigin()}/api${path}`
}

/**
 * Auth relies on the httpOnly `theia_session` cookie (sent with `credentials: "include"`).
 * The JWT is never readable from JS anymore, so there is no token to attach.
 * Kept as a no-op so existing fetch helpers keep working.
 */
export function getAuthToken(): string | null {
  return null
}

/** Headers for backend requests (auth is carried by the httpOnly cookie) */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra }
}

/** Remove the token older versions kept in localStorage (readable by any XSS) */
function purgeLegacyToken() {
  try {
    if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable: nothing to purge
  }
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
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    purgeLegacyToken()
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
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    await fetch(getBackendUrl("/auth/logout"), {
      method: "POST",
      credentials: "include",
    }).catch(() => {})
    purgeLegacyToken()
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
