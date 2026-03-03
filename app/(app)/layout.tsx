"use client"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { TheiaFooter } from "@/components/theia-footer"
import { TheiaWatermark } from "@/components/theia-watermark"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader2 } from "lucide-react"

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login")
    }
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground font-mono">THEIA</span>
        </div>
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="flex flex-col min-h-screen relative overflow-hidden">
            <TheiaWatermark />
            <div className="relative z-10 flex flex-col flex-1">
              {children}
              <TheiaFooter />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </AuthGate>
    </AuthProvider>
  )
}
