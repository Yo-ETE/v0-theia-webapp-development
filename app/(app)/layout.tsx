"use client"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { TheiaFooter } from "@/components/theia-footer"
import { TheiaWatermark } from "@/components/theia-watermark"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { ConnectionStatus } from "@/components/connection-status"
import { Toaster } from "@/components/ui/sonner"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader2, RefreshCw, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, hubUnreachable, refresh } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Only send someone to the login form when the hub actually said they are not
    // authenticated. If nothing answered, the login form is a lie: it invites a password
    // that cannot be checked, and hides the real problem.
    if (!isLoading && !user && !hubUnreachable) {
      router.replace("/login")
    }
  }, [isLoading, user, hubUnreachable, router])

  if (!isLoading && hubUnreachable && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <WifiOff className="h-10 w-10 text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Hub injoignable</p>
            <p className="text-xs text-muted-foreground">
              Le hub ne repond pas. Ce n&apos;est pas un probleme de session : inutile de vous
              reconnecter tant qu&apos;il n&apos;a pas repondu.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4" />
            Reessayer
          </Button>
        </div>
      </div>
    )
  }

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
              <ConnectionStatus />
              {children}
              <TheiaFooter />
            </div>
            <Toaster position="top-right" richColors closeButton />
          </SidebarInset>
        </SidebarProvider>
      </AuthGate>
    </AuthProvider>
  )
}
