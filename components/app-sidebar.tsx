"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Crosshair,
  Radio,
  ScrollText,
  Settings,
  RefreshCw,
  LogOut,
  User,
  Shield,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar"

import { NotificationBell } from "@/components/notification-bell"
import { useAuth } from "@/lib/auth-context"

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, adminOnly: false },
  { title: "Missions", href: "/missions", icon: Crosshair, adminOnly: false },
  { title: "Devices", href: "/devices", icon: Radio, adminOnly: false },
  { title: "Logs", href: "/logs", icon: ScrollText, adminOnly: false },
  { title: "Administration", href: "/admin", icon: Settings, adminOnly: true },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAdmin, logout } = useAuth()

  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin)

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 border border-primary/20">
              <svg viewBox="0 0 300 300" className="h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg">
                <circle cx="150" cy="150" r="100" stroke="currentColor" strokeWidth="12" fill="none" />
                <circle cx="150" cy="150" r="60" stroke="currentColor" strokeWidth="8" fill="none" opacity="0.6" />
                <line x1="150" y1="150" x2="230" y2="120" stroke="currentColor" strokeWidth="10" />
                <circle cx="150" cy="150" r="18" fill="currentColor" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-wider text-sidebar-foreground">
                THEIA
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Hub Control
              </span>
            </div>
          </Link>
          <NotificationBell />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href))
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {user && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 border border-primary/20 shrink-0">
              {isAdmin ? <Shield className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-medium text-sidebar-foreground truncate">{user.username}</span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{user.role}</span>
            </div>
            <button
              onClick={async () => {
                await logout()
                router.replace("/login")
              }}
              className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              title="Se deconnecter"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[9px] text-muted-foreground/50 tracking-wider">
            THEIA Hub Control v1.0
          </p>
          <button
            onClick={async () => {
              if ("serviceWorker" in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations()
                for (const r of regs) await r.unregister()
              }
              if ("caches" in window) {
                const names = await caches.keys()
                for (const n of names) await caches.delete(n)
              }
              window.location.reload()
            }}
            className="flex items-center gap-1 text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors min-h-[32px] min-w-[32px] justify-center rounded"
            title="Vider le cache et recharger"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
