"use client"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { TheiaFooter } from "@/components/theia-footer"
import { TheiaWatermark } from "@/components/theia-watermark"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
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
  )
}
