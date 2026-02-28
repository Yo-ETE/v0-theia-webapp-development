"use client"

import { AuthProvider } from "@/lib/auth-context"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen flex items-center justify-center bg-background">
        {children}
      </div>
    </AuthProvider>
  )
}
