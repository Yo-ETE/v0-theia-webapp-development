"use client"

import { useState, useCallback } from "react"
import { Radio, Battery, Signal, Plus, Trash2 } from "lucide-react"
import { TopHeader } from "@/components/top-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useDevices, useMissions } from "@/hooks/use-api"
import { createDevice, deleteDevice, updateDevice } from "@/lib/api-client"
import { deviceStatusConfig, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function DevicesPage() {
  const { data: devices, isLoading, mutate } = useDevices({ includeDisabled: true })
  const { data: missions } = useMissions()
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollForm, setEnrollForm] = useState({ name: "", dev_eui: "", type: "microwave_tx", serial_port: "" })
  const [enrolling, setEnrolling] = useState(false)

  function getMissionName(missionId: string | null) {
    if (!missionId || !missions) return "---"
    const m = missions.find((m) => m.id === missionId)
    return m?.name ?? "---"
  }

  const handleEnroll = useCallback(async () => {
    if (!enrollForm.name.trim() || !enrollForm.dev_eui.trim()) return
    setEnrolling(true)
    try {
      await createDevice({
        name: enrollForm.name.trim(),
        dev_eui: enrollForm.dev_eui.trim(),
        type: enrollForm.type,
        serial_port: enrollForm.serial_port.trim(),
      })
      setEnrollOpen(false)
      setEnrollForm({ name: "", dev_eui: "", type: "microwave_tx", serial_port: "" })
      mutate()
    } catch (err) {
      console.error("Enroll failed:", err)
    } finally {
      setEnrolling(false)
    }
  }, [enrollForm, mutate])

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Remove device "${name}"? It will be disabled and ignored by auto-enroll. You can re-enable it later.`)) return
    await deleteDevice(id)
    mutate()
  }, [mutate])

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await updateDevice(id, { enabled: !enabled } as never)
    mutate()
  }, [mutate])

  const enabledDevices = devices?.filter((d) => d.enabled !== 0) ?? []
  const disabledDevices = devices?.filter((d) => d.enabled === 0) ?? []
  const onlineCount = enabledDevices.filter((d) => d.status === "online").length
  const offlineCount = enabledDevices.filter((d) => d.status === "offline").length
  const totalCount = enabledDevices.length
  const disabledCount = disabledDevices.length

  return (
    <>
      <TopHeader title="Devices" description="TX/RX device management and enrollment" />
      <main className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Stats + Enroll button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{totalCount}</span>
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-medium text-success">{onlineCount}</span>
                <span className="text-xs text-muted-foreground">Online</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                <span className="text-sm font-medium text-destructive">{offlineCount}</span>
                <span className="text-xs text-muted-foreground">Offline</span>
              </div>
              {disabledCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  <span className="text-sm font-medium text-muted-foreground">{disabledCount}</span>
                  <span className="text-xs text-muted-foreground">Disabled</span>
                </div>
              )}
            </div>
            <Button size="sm" onClick={() => setEnrollOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Enroll Device
            </Button>
          </div>

          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All Devices</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 animate-pulse rounded bg-muted" />
              ) : devices?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Radio className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No devices enrolled</p>
                  <p className="text-xs text-muted-foreground">
                    Click "Enroll Device" to register a TX module with its serial port
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-[10px]">Name</TableHead>
                      <TableHead className="text-[10px]">DEV EUI</TableHead>
                      <TableHead className="text-[10px]">Port</TableHead>
                      <TableHead className="text-[10px]">Sensor</TableHead>
                      <TableHead className="text-[10px]">Status</TableHead>
                      <TableHead className="text-[10px]">Mission</TableHead>
                      <TableHead className="text-[10px]">Zone / Side</TableHead>
                      <TableHead className="text-[10px]">RSSI</TableHead>
                      <TableHead className="text-[10px]">Battery</TableHead>
                      <TableHead className="text-[10px]">Last Seen</TableHead>
                      <TableHead className="text-[10px]">Enabled</TableHead>
                      <TableHead className="text-[10px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices?.map((device) => {
                      const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                      return (
                        <TableRow key={device.id} className={cn("border-border/30", device.enabled === 0 && "opacity-40")}>
                          <TableCell className="font-mono text-xs font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <Signal className={cn("h-3 w-3", sCfg.className.includes("success") ? "text-success" : sCfg.className.includes("destructive") ? "text-destructive" : "text-muted-foreground")} />
                              {device.name}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">
                            {device.dev_eui ?? device.hw_id ?? "---"}
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">
                            {device.serial_port || "---"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={device.type ?? "microwave_tx"}
                              onValueChange={async (val) => {
                                try {
                                  await updateDevice(device.id, { type: val })
                                  mutate()
                                } catch (e) { console.error("Failed to update sensor type:", e) }
                              }}
                            >
                              <SelectTrigger className="h-7 text-[10px] w-[110px] border-border/40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="microwave_tx" className="text-[10px]">LD2450</SelectItem>
                                <SelectItem value="c4001" className="text-[10px]">C4001</SelectItem>
                                <SelectItem value="gravity_mw" className="text-[10px]">Gravity MW V2</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] px-1 py-0", sCfg.className)}>
                              <span className={cn("mr-1 h-1.5 w-1.5 rounded-full inline-block", sCfg.dot)} />
                              {sCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-foreground">
                            {getMissionName(device.mission_id)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {device.zone_label ? (
                              <span>
                                {device.zone_label}
                                {device.side && <span className="ml-1 text-primary font-mono">[{device.side}]</span>}
                              </span>
                            ) : "---"}
                          </TableCell>
                          <TableCell>
                            {device.rssi != null ? (
                              <span className={cn(
                                "font-mono text-[11px]",
                                device.rssi >= -70 ? "text-success" : device.rssi >= -85 ? "text-warning" : "text-destructive"
                              )}>
                                {device.rssi}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {device.battery != null ? (
                              <div className="flex items-center gap-1">
                                <Battery className={cn(
                                  "h-3 w-3",
                                  device.battery > 50 ? "text-success" : device.battery > 20 ? "text-warning" : "text-destructive"
                                )} />
                                <span className="font-mono text-[11px]">{device.battery}%</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">
                            {device.last_seen ? formatRelative(device.last_seen) : "Never"}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={!!device.enabled}
                              onCheckedChange={() => handleToggle(device.id, !!device.enabled)}
                              aria-label={`Toggle ${device.name}`}
                              className="scale-75"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="sm"
                              className="h-6 w-6 p-0 text-destructive/60 hover:text-destructive"
                              onClick={() => handleDelete(device.id, device.name)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Enroll Device Dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Enroll New Device</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Register a TX or RX module. The serial port is used to identify which device sends data.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Device Name</Label>
              <Input
                placeholder="TX-Facade-Nord"
                value={enrollForm.name}
                onChange={(e) => setEnrollForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-input/50 border-border text-sm h-8"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">DEV EUI / Hardware ID</Label>
              <Input
                placeholder="AA:BB:CC:DD:00:01"
                value={enrollForm.dev_eui}
                onChange={(e) => setEnrollForm((f) => ({ ...f, dev_eui: e.target.value }))}
                className="bg-input/50 border-border font-mono text-sm h-8"
              />
              <p className="text-[10px] text-muted-foreground">
                Unique identifier for the LoRa module (MAC or custom ID)
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Serial Port (RX)</Label>
              <Input
                placeholder="/dev/ttyUSB1"
                value={enrollForm.serial_port}
                onChange={(e) => setEnrollForm((f) => ({ ...f, serial_port: e.target.value }))}
                className="bg-input/50 border-border font-mono text-sm h-8"
              />
              <p className="text-[10px] text-muted-foreground">
                USB port where the RX for this TX is connected (e.g. /dev/ttyUSB1)
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={enrollForm.type} onValueChange={(v) => setEnrollForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="h-8 text-xs bg-input/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="microwave_tx">Microwave TX (LD2450/LD2410)</SelectItem>
                  <SelectItem value="c4001">Gravity C4001 (depth-only)</SelectItem>
                  <SelectItem value="pir_tx">PIR TX</SelectItem>
                  <SelectItem value="vibration_tx">Vibration TX</SelectItem>
                  <SelectItem value="magnetic_tx">Magnetic Contact TX</SelectItem>
                  <SelectItem value="custom_tx">Custom TX</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleEnroll}
              disabled={!enrollForm.name.trim() || !enrollForm.dev_eui.trim() || enrolling}
            >
              {enrolling ? "Enrolling..." : "Enroll Device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
