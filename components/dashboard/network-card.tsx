import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Network } from "lucide-react"
import type { NetworkInfo } from "@/lib/types"

export function NetworkCard({ network }: { network: NetworkInfo }) {
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Network className="h-4 w-4 text-info" />
          Network
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Hostname</span>
          <span className="font-mono text-xs text-foreground">{network.hostname}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">LAN IP</span>
          <span className="font-mono text-xs text-foreground">{network.lan_ip}</span>
        </div>
        {network.tailscale_ip && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Tailscale</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-foreground">{network.tailscale_ip}</span>
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success text-[9px] px-1 py-0">
                VPN
              </Badge>
            </div>
          </div>
        )}
        <div className="mt-1 border-t border-border/50 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Interfaces</p>
          {Object.entries(network.interfaces).map(([iface, ip]) => (
            <div key={iface} className="flex items-center justify-between py-0.5">
              <span className="font-mono text-[11px] text-muted-foreground">{iface}</span>
              <span className="font-mono text-[11px] text-foreground">{ip}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
