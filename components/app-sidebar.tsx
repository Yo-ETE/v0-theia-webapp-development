"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Crosshair,
  Radio,
  ScrollText,
  Wifi,
  Settings,
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
import { Badge } from "@/components/ui/badge"
import { NotificationBell } from "@/components/notification-bell"

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Missions", href: "/missions", icon: Crosshair },
  { title: "Devices", href: "/devices", icon: Radio },
  { title: "Logs", href: "/logs", icon: ScrollText },
  { title: "Administration", href: "/admin", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()

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
              {navItems.map((item) => {
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

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-2">
          <Wifi className="h-3.5 w-3.5 text-success" />
          <span className="text-xs text-muted-foreground">Preview Mode</span>
          <Badge
            variant="outline"
            className="ml-auto border-success/30 bg-success/10 text-success text-[10px] px-1.5 py-0"
          >
            ONLINE
          </Badge>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
