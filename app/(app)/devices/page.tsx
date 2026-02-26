"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Radio, Battery, Signal, Plus, Trash2, Cpu, Upload, Terminal, X } from "lucide-react"
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
import { BatteryChart } from "@/components/battery-chart"
import { createDevice, deleteDevice, updateDevice } from "@/lib/api-client"
import { deviceStatusConfig, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function DevicesPage() {
  const { data: devices, isLoading, mutate } = useDevices({ includeDisabled: true })
  const { data: missions } = useMissions()
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollForm, setEnrollForm] = useState({ name: "", dev_eui: "", type: "microwave_tx", serial_port: "" })
  const [enrolling, setEnrolling] = useState(false)

  // Flash / Provisioning wizard state
  const [flashOpen, setFlashOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1) // 1=name, 2=plug USB, 3=type, 4=flash
  const [flashForm, setFlashForm] = useState({ tx_id: "", sensor_type: "ld2450", port: "", port_serial: "", sketch_name: "__default__", custom_sketch: null as File | null })
  const [flashLogs, setFlashLogs] = useState<string[]>([])
  const [flashing, setFlashing] = useState(false)
  const [flashDone, setFlashDone] = useState<"ok" | "fail" | null>(null)
  type PortInfo = {port: string; real: string; summary?: string; label?: string; usb_serial?: string; esp32_mac?: string; mac_warning?: string}
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [detectedPort, setDetectedPort] = useState<PortInfo | null>(null)
  const [systemPorts, setSystemPorts] = useState<{symlink: string; real: string; role: string}[]>([])
  const [txIdError, setTxIdError] = useState("")
  const [portVerified, setPortVerified] = useState<{safe: boolean; reason?: string; vid?: string; pid?: string; manufacturer?: string; description?: string; label?: string; real?: string} | null>(null)
  const [portVerifying, setPortVerifying] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const baselineRef = useRef<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const backendBase = typeof window !== "undefined" ? `http://${window.location.hostname}:8000` : ""

  // Step 2: snapshot baseline then poll for new ports
  const [usbDebug, setUsbDebug] = useState("")
  useEffect(() => {
    if (!flashOpen || wizardStep !== 2) return
    let cancelled = false
    let baselineRawCount = 0
    let baselineReady = false

    const init = async () => {
      try {
        const res = await fetch(`${backendBase}/api/firmware/ports`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const portList: PortInfo[] = data.ports ?? data
        const allRaw: string[] = data.all_raw ?? []

        // Baseline = ALL raw USB ports currently plugged in
        const allReals = new Set<string>()
        allRaw.forEach(r => allReals.add(r))
        // Also add free ports' real paths as fallback
        portList.forEach(p => allReals.add(p.real))

        baselineRef.current = allReals
        baselineRawCount = allRaw.length || allReals.size
        setPorts(portList)
        setSystemPorts(data.system ?? [])
        baselineReady = true
        setDetectedPort(null)
        setUsbDebug(`Baseline: ${baselineRawCount} ports USB (${[...allReals].map(r => r.replace("/dev/","")).join(", ")})`)
      } catch (err) {
        setUsbDebug(`Erreur init: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    init()

    // Poll every 1.5s for new ports
    const interval = setInterval(async () => {
      if (!baselineReady || cancelled) return
      try {
        const res = await fetch(`${backendBase}/api/firmware/ports`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const portList: PortInfo[] = data.ports ?? data
        const allRaw: string[] = data.all_raw ?? []
        const busyPorts: string[] = data.busy_ports ?? []
        const skipped: Array<{port: string, real: string, reason: string}> = data.skipped ?? []
        const currentRawCount = allRaw.length
        const busySet = new Set(busyPorts)

        setPorts(portList)

        // Method 1: check if any free port has a real path NOT in the baseline
        let newPort = portList.find(p => !baselineRef.current.has(p.real))

        // Method 2: if raw count increased, there's a new device even if
        // it landed on a different ttyUSB number after re-enumeration
        if (!newPort && currentRawCount > baselineRawCount && portList.length > 0) {
          newPort = portList[portList.length - 1] // take the last free port
        }

        // Method 3: if a new raw port appeared that wasn't in the baseline,
        // offer it even if it's "reserved" (enrolled port re-enumeration).
        // CRITICAL: NEVER offer a system port (theia-rx, theia-gps realpath).
        if (!newPort) {
          const newRaw = allRaw.find(r => !baselineRef.current.has(r) && !busySet.has(r))
          if (newRaw) {
            const skippedInfo = skipped.find(s => s.real === newRaw || s.port === newRaw)
            const syntheticPort: PortInfo = {
              port: newRaw, real: newRaw,
              label: skippedInfo ? `Reserve: ${skippedInfo.reason}` : "",
              summary: `Nouveau (${newRaw.replace("/dev/", "")})`
            }
            newPort = syntheticPort
          }
        }

        if (newPort) {
          setDetectedPort(newPort)
          setFlashForm(f => ({ ...f, port: newPort!.port, port_serial: newPort!.usb_serial || "" }))
          setUsbDebug(`Detecte: ${newPort.port} (${newPort.real})`)
          clearInterval(interval)
        } else {
          const skippedPorts = skipped.map((s: { port: string; reason: string }) => `${s.port.replace("/dev/","")}(${s.reason})`).join(", ")
          const busyPorts = (data.busy_ports || []).map((p: string) => p.replace("/dev/","")).join(", ")
          const debugParts = [`${currentRawCount} raw, ${portList.length} libres`]
          if (skippedPorts) debugParts.push(`Filtres: ${skippedPorts}`)
          if (busyPorts) debugParts.push(`Occupes: ${busyPorts}`)
          setUsbDebug(`Recherche... ${debugParts.join(" | ")}`)
        }
      } catch (err) {
        setUsbDebug(`Erreur poll: ${err instanceof Error ? err.message : String(err)}`)
      }
    }, 2000)  // 2s poll -- no heavy esptool calls, just bridge port check

    return () => { cancelled = true; clearInterval(interval) }
  }, [flashOpen, wizardStep, backendBase])

  // Verify port safety when detected or changed
  useEffect(() => {
    if (!flashForm.port) { setPortVerified(null); return }
    let cancelled = false
    setPortVerifying(true)
    setPortVerified(null)
    fetch(`${backendBase}/api/firmware/verify-port?port=${encodeURIComponent(flashForm.port)}`)
    .then(r => r.json())
    .then(data => {
      if (!cancelled) {
        setPortVerified(data)
        setPortVerifying(false)
        // Capture USB serial for safety verification during flash
        if (data.usb_serial) setFlashForm(f => ({ ...f, port_serial: data.usb_serial }))
      }
    })
    .catch(() => { if (!cancelled) { setPortVerified({ safe: true }); setPortVerifying(false) } })
    return () => { cancelled = true }
  }, [flashForm.port, backendBase])

  // Auto-scroll flash logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [flashLogs])

  // Validate TX_ID uniqueness
  useEffect(() => {
    if (!flashForm.tx_id.trim()) { setTxIdError(""); return }
    const existing = devices?.find(d => d.dev_eui === flashForm.tx_id.trim())
    setTxIdError(existing ? `${flashForm.tx_id} deja utilise` : "")
  }, [flashForm.tx_id, devices])

  const handleFlash = useCallback(async () => {
    if (!flashForm.tx_id.trim() || !flashForm.port || txIdError) return
    setFlashing(true)
    setFlashDone(null)
    setFlashLogs([])

    try {
      // If custom sketch file, upload it first
      let customSketchName: string | null = null
      if (flashForm.custom_sketch) {
        const uploadData = new FormData()
        uploadData.append("file", flashForm.custom_sketch)
        uploadData.append("sensor_type", flashForm.sensor_type)
        try {
          const upRes = await fetch(`${backendBase}/api/firmware/upload-sketch`, {
            method: "POST",
            body: uploadData,
          })
          if (upRes.ok) {
            const upJson = await upRes.json()
            customSketchName = upJson.name
            setFlashLogs(prev => [...prev, `[OK] Sketch importe: ${upJson.name}`])
          } else {
            const err = await upRes.json().catch(() => ({ detail: "Erreur upload" }))
            setFlashLogs(prev => [...prev, `[ERROR] Upload sketch: ${err.detail}`])
            setFlashDone("fail")
            setFlashing(false)
            return
          }
        } catch (e) {
          setFlashLogs(prev => [...prev, `[ERROR] Upload: ${e instanceof Error ? e.message : String(e)}`])
          setFlashDone("fail")
          setFlashing(false)
          return
        }
      }

      const res = await fetch(`${backendBase}/api/firmware/flash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        port: flashForm.port,
        tx_id: flashForm.tx_id.trim(),
        sensor_type: flashForm.sensor_type,
        sketch_name: customSketchName || (flashForm.sketch_name === "__default__" ? null : flashForm.sketch_name),
        port_serial: flashForm.port_serial || null,
      }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Erreur inconnue" }))
        setFlashLogs(prev => [...prev, `[ERROR] ${err.detail || res.statusText}`])
        setFlashDone("fail")
        setFlashing(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          const lines = text.split("\n").filter(l => l.startsWith("data: "))
          for (const line of lines) {
            const msg = line.replace("data: ", "").trim()
            if (msg === "[DONE] OK") {
              setFlashDone("ok")
            } else if (msg === "[DONE] FAIL") {
              setFlashDone("fail")
            } else if (msg) {
              setFlashLogs(prev => [...prev, msg])
            }
          }
        }
      }
    } catch (e) {
      setFlashLogs(prev => [...prev, `[ERROR] ${e instanceof Error ? e.message : String(e)}`])
      setFlashDone("fail")
    } finally {
      setFlashing(false)
      mutate()  // Refresh devices list
    }
  }, [flashForm, txIdError, backendBase, mutate])

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
    if (!confirm(`Supprimer le device "${name}" ? Cette action est irreversible.`)) return
    try {
      await deleteDevice(id)
    } catch (err) {
      console.error("[v0] Delete failed:", err)
    }
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{totalCount}</span>
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-medium text-success">{onlineCount}</span>
                <span className="text-xs text-muted-foreground">Online</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                <span className="text-sm font-medium text-destructive">{offlineCount}</span>
                <span className="text-xs text-muted-foreground">Offline</span>
              </div>
              {disabledCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  <span className="text-sm font-medium text-muted-foreground">{disabledCount}</span>
                  <span className="text-xs text-muted-foreground">Disabled</span>
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFlashOpen(true)
                setWizardStep(1)
                setFlashLogs([])
                setFlashDone(null)
                setDetectedPort(null)
                baselineRef.current = new Set()
                setFlashForm({ tx_id: "", sensor_type: "ld2450", port: "", port_serial: "", sketch_name: "__default__", custom_sketch: null })
              }}
              className="gap-1.5 shrink-0"
            >
              <Cpu className="h-3.5 w-3.5" />
              Nouveau capteur
            </Button>
          </div>

          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">All Devices</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 animate-pulse rounded bg-muted" />
              ) : enabledDevices.length === 0 ? (
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
                    {enabledDevices.map((device) => {
                      const sCfg = deviceStatusConfig[device.status] ?? deviceStatusConfig.unknown
                      return (
                        <TableRow key={device.id} className="border-border/30">
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
                            {device.rssi != null && device.rssi !== 0 ? (
                              <span className={cn(
                                "font-mono text-[11px]",
                                device.rssi >= -70 ? "text-success" : device.rssi >= -85 ? "text-warning" : "text-destructive"
                              )}>
                                {Math.round(device.rssi)}dBm
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {device.battery != null && Number(device.battery) > 0 ? (
                              <div className="flex items-center gap-1">
                                <Battery className={cn(
                                  "h-3 w-3",
                                  Number(device.battery) > 4.0 ? "text-success" : Number(device.battery) > 3.5 ? "text-warning" : "text-destructive"
                                )} />
                                <span className="font-mono text-[11px]">{Number(device.battery).toFixed(2)}V</span>
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
          {/* Battery consumption chart */}
          <BatteryChart />
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

      {/* Flash / Provision Dialog */}
      <Dialog open={flashOpen} onOpenChange={(o) => { if (!flashing) setFlashOpen(o) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Nouveau capteur
            </DialogTitle>
            <DialogDescription className="text-xs">
              {wizardStep === 1 && "Etape 1/4 -- Identifiez le nouveau capteur"}
              {wizardStep === 2 && "Etape 2/4 -- Branchez le capteur ESP32 en USB"}
              {wizardStep === 3 && "Etape 3/4 -- Type de capteur et firmware"}
              {wizardStep === 4 && "Etape 4/4 -- Compilation et flash"}
            </DialogDescription>
          </DialogHeader>

          {/* Progress bar */}
          <div className="flex gap-1">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                s <= wizardStep ? "bg-primary" : "bg-muted"
              )} />
            ))}
          </div>

          {/* Step 1: TX ID */}
          {wizardStep === 1 && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Identifiant TX</Label>
                <Input
                  value={flashForm.tx_id}
                  onChange={(e) => setFlashForm(f => ({ ...f, tx_id: e.target.value.toUpperCase() }))}
                  placeholder="TX03"
                  className="h-10 text-sm bg-input/50 border-border font-mono"
                  autoFocus
                />
                {txIdError && <p className="text-[10px] text-destructive">{txIdError}</p>}
                <p className="text-[10px] text-muted-foreground">
                  Identifiant unique du capteur (ex: TX03, TX04...). Sera ecrit dans le firmware.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: USB detection */}
          {wizardStep === 2 && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col items-center gap-3 py-4">
                {!detectedPort ? (
                  <>
                    <div className="h-16 w-16 rounded-full border-2 border-dashed border-primary/40 flex items-center justify-center animate-pulse">
                      <Cpu className="h-7 w-7 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Branchez le capteur ESP32 en USB</p>
                    <p className="text-[10px] text-muted-foreground text-center max-w-[280px]">
                      {"Connectez l'ESP32 au Raspberry Pi via un cable USB. Le port sera detecte automatiquement."}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      <span className="text-[10px] text-muted-foreground">Recherche en cours...</span>
                    </div>
                    {usbDebug && (
                      <p className="text-[9px] font-mono text-muted-foreground/60 mt-1 max-w-[320px] text-center">{usbDebug}</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className={cn(
                      "h-16 w-16 rounded-full border-2 flex items-center justify-center",
                      portVerified?.safe === false ? "border-destructive bg-destructive/10" : "border-success bg-success/10"
                    )}>
                      <Cpu className={cn("h-7 w-7", portVerified?.safe === false ? "text-destructive" : "text-success")} />
                    </div>
                    <p className={cn("text-sm font-medium", portVerified?.safe === false ? "text-destructive" : "text-success")}>
                      {portVerified?.safe === false ? "Port non securise" : "Capteur detecte"}
                    </p>
                    {portVerified?.safe === false && (
                      <p className="text-[10px] text-destructive text-center max-w-[300px]">{portVerified.reason}</p>
                    )}
                    <div className={cn(
                      "rounded-md border px-4 py-2.5 w-full",
                      portVerified?.safe === false ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-foreground">{detectedPort.port}</span>
                        <Badge variant="outline" className={cn("text-[9px]", portVerified?.safe === false ? "border-destructive/40 text-destructive" : "border-success/40 text-success")}>
                          {portVerifying ? "verification..." : portVerified?.safe === false ? "BLOQUE" : "nouveau"}
                        </Badge>
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1 font-mono">{detectedPort.real}</p>
                      {detectedPort.summary && (
                        <p className="text-[9px] text-muted-foreground mt-0.5">{detectedPort.summary}</p>
                      )}
                      {portVerified?.label && (
                        <p className="text-[9px] text-muted-foreground mt-0.5">ID: {portVerified.label}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Manual fallback -- show when auto-detection doesn't find a port */}
              {!detectedPort && (
                <div className="border-t border-border/50 pt-3">
                  {ports.length > 0 ? (
                    <>
                      <p className="text-[10px] text-muted-foreground mb-2">Ou selectionner un port manuellement :</p>
                      <Select
                        value={flashForm.port}
                        onValueChange={(v) => {
                          const found = ports.find(p => p.port === v)
                          if (found) { setDetectedPort(found); setFlashForm(f => ({ ...f, port: v })) }
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-input/50 border-border font-mono">
                          <SelectValue placeholder="Selectionnez un port" />
                        </SelectTrigger>
                        <SelectContent>
                          {ports.map((p) => (
                            <SelectItem key={p.port} value={p.port} className="text-xs">
                              <div className="flex flex-col">
                                <span className="font-mono">{p.port}</span>
                                <span className="text-[9px] text-muted-foreground">{p.summary || p.real}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-amber-400 mb-1">Aucun port libre detecte.</p>
                      <p className="text-[9px] text-muted-foreground mb-2">
                        Tous les ports sont reserves. Entrez manuellement le chemin du port si le capteur est branche :
                      </p>
                      <input
                        type="text"
                        placeholder="/dev/ttyUSB2 ou /dev/ttyACM0"
                        className="h-8 w-full rounded-md border border-border bg-input/50 px-3 text-xs font-mono text-foreground placeholder:text-muted-foreground/50"
                        onBlur={(e) => {
                          const val = e.target.value.trim()
                          if (val) {
                            setDetectedPort({ port: val, real: val, label: "", summary: "Port manuel" })
                            setFlashForm(f => ({ ...f, port: val }))
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = (e.target as HTMLInputElement).value.trim()
                            if (val) {
                              setDetectedPort({ port: val, real: val, label: "", summary: "Port manuel" })
                              setFlashForm(f => ({ ...f, port: val }))
                            }
                          }
                        }}
                      />
                      {usbDebug && (
                        <p className="text-[8px] font-mono text-muted-foreground/50 mt-2 break-all">{usbDebug}</p>
                      )}
                    </>
                  )}
                </div>
              )}
{systemPorts.length > 0 && (
  <p className="text-[9px] text-muted-foreground">
Symlinks : {systemPorts.map(s => `${s.symlink} -> ${s.real} (${s.role})`).join(", ")}
  </p>
  )}
            </div>
          )}

          {/* Step 3: Sensor type */}
          {wizardStep === 3 && (
            <div className="flex flex-col gap-4 py-2">
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 flex items-center gap-3">
                <Cpu className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-xs text-foreground">{flashForm.tx_id}</span>
                <span className="font-mono text-[9px] text-muted-foreground">{flashForm.port}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium">Type de capteur</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { val: "ld2450", name: "LD2450", desc: "Radar mmWave HLK-LD2450. Multi-cible, distance + angle.", sketch: "TX_LD2450" },
                    { val: "c4001", name: "C4001", desc: "Radar DFRobot SEN0609. Mono-cible, presence + distance.", sketch: "TX_C4001" },
                  ] as const).map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => setFlashForm(f => ({ ...f, sensor_type: opt.val, sketch_name: "__default__", custom_sketch: null }))}
                      className={cn(
                        "rounded-md border p-3 text-left transition-colors",
                        flashForm.sensor_type === opt.val && !flashForm.custom_sketch
                          ? "border-primary bg-primary/5"
                          : "border-border/50 hover:border-border"
                      )}
                    >
                      <span className="text-xs font-medium text-foreground">{opt.name}</span>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{opt.desc}</p>
                      <p className="text-[8px] text-muted-foreground/60 mt-1 font-mono">Sketch: {opt.sketch}</p>
                    </button>
                  ))}
                </div>
              </div>
              {/* Import custom sketch */}
              <div className="border-t border-border/50 pt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ino,.cpp,.c"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setFlashForm(f => ({ ...f, custom_sketch: file, sketch_name: file.name }))
                    }
                  }}
                />
                {flashForm.custom_sketch ? (
                  <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                    <Upload className="h-3.5 w-3.5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{flashForm.custom_sketch.name}</p>
                      <p className="text-[9px] text-muted-foreground">Sketch personnalise</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setFlashForm(f => ({ ...f, custom_sketch: null, sketch_name: "__default__" }))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3 w-3" />
                    Importer un sketch .ino
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Compile & Flash */}
          {wizardStep === 4 && (
            <div className="flex flex-col gap-3 py-2">
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 flex items-center gap-3 text-xs">
                <Cpu className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-foreground">{flashForm.tx_id}</span>
                <span className="text-muted-foreground">{flashForm.sensor_type.toUpperCase()}</span>
                <span className="font-mono text-muted-foreground ml-auto">{flashForm.port}</span>
              </div>

              {(flashLogs.length > 0 || flashing) && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Terminal className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Console</span>
                    {flashing && <span className="ml-auto text-[10px] text-primary animate-pulse">En cours...</span>}
                  </div>
                  <div className="rounded-md border border-border bg-background p-2 max-h-48 overflow-y-auto font-mono text-[10px] leading-4 text-muted-foreground">
                    {flashLogs.map((line, i) => (
                      <div key={i} className={cn(
                        line.startsWith("[ERROR]") && "text-destructive",
                        line.startsWith("[OK]") && "text-success",
                        line.startsWith("[WARN]") && "text-warning",
                        line.startsWith("[STEP]") && "text-primary font-semibold",
                      )}>{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}

              {flashDone === "ok" && (
                <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                  Flash termine avec succes. Le device {flashForm.tx_id} a ete enregistre.
                </div>
              )}
              {flashDone === "fail" && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Echec du flash. Verifiez la console ci-dessus.
                </div>
              )}

              {!flashing && !flashDone && flashLogs.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Pret a compiler et flasher le firmware sur {flashForm.tx_id} via {flashForm.port}.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setFlashOpen(false)} disabled={flashing}>
              {flashDone ? "Fermer" : "Annuler"}
            </Button>
            <div className="flex-1" />
            {wizardStep > 1 && !flashing && !flashDone && (
              <Button variant="outline" size="sm" onClick={() => setWizardStep(s => s - 1)}>Retour</Button>
            )}
            {wizardStep === 1 && (
              <Button size="sm" onClick={() => setWizardStep(2)} disabled={!flashForm.tx_id.trim() || !!txIdError}>
                Suivant
              </Button>
            )}
            {wizardStep === 2 && (
              <Button size="sm" onClick={() => setWizardStep(3)} disabled={!flashForm.port || portVerifying || portVerified?.safe === false}>Suivant</Button>
            )}
            {wizardStep === 3 && (
              <Button size="sm" onClick={() => { setWizardStep(4); setFlashLogs([]); setFlashDone(null) }}>Suivant</Button>
            )}
            {wizardStep === 4 && !flashDone && (
              <Button size="sm" onClick={handleFlash} disabled={flashing} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                {flashing ? "Flash en cours..." : "Compiler & Flash"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
