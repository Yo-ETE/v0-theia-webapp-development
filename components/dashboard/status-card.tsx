import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatusCardProps {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  status?: "success" | "warning" | "critical" | "info" | "neutral"
}

const statusStyles = {
  success: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
  info: "text-info",
  neutral: "text-muted-foreground",
}

const statusBg = {
  success: "bg-success/10",
  warning: "bg-warning/10",
  critical: "bg-destructive/10",
  info: "bg-info/10",
  neutral: "bg-muted",
}

export function StatusCard({
  title,
  value,
  subtitle,
  icon: Icon,
  status = "neutral",
}: StatusCardProps) {
  return (
    <Card className="border-border/50 bg-card py-4">
      <CardContent className="flex items-center gap-4 px-4">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            statusBg[status],
          )}
        >
          <Icon className={cn("h-5 w-5", statusStyles[status])} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className={cn("text-lg font-semibold font-mono tabular-nums", statusStyles[status])}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
