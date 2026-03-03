"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Cpu,
  FileCode,
  Upload,
  Trash2,
  Pencil,
  Eye,
  X,
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Sketch = {
  name: string
  file: string
  is_template: boolean
  sensor_type: string
}

function _getApi(): string {
  if (typeof window === "undefined") return "http://localhost:8000"
  return `http://${window.location.hostname}:8000`
}
function _bH(): Record<string, string> {
  const t = typeof window !== "undefined" ? localStorage.getItem("theia_token") : null
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export function FirmwareManager() {
  const [sketches, setSketches] = useState<Sketch[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  // View / edit state
  const [viewSketch, setViewSketch] = useState<{ name: string; file: string; content: string } | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Upload
  const [uploading, setUploading] = useState(false)

  const fetchSketches = useCallback(async () => {
    try {
      const res = await fetch(`${_getApi()}/api/firmware/sketches`, {
        credentials: "include", headers: _bH(),
      })
      if (res.ok) setSketches(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchSketches() }, [fetchSketches])

  const handleView = async (name: string) => {
    setLoadingContent(true)
    setEditMode(false)
    try {
      const res = await fetch(`${_getApi()}/api/firmware/sketches/${encodeURIComponent(name)}`, {
        credentials: "include", headers: _bH(),
      })
      if (res.ok) {
        const data = await res.json()
        setViewSketch(data)
        setEditContent(data.content)
      }
    } catch { /* ignore */ }
    setLoadingContent(false)
  }

  const handleSave = async () => {
    if (!viewSketch) return
    setSaving(true)
    try {
      const res = await fetch(`${_getApi()}/api/firmware/sketches/${encodeURIComponent(viewSketch.name)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ..._bH() },
        body: JSON.stringify({ content: editContent }),
      })
      if (res.ok) {
        setViewSketch({ ...viewSketch, content: editContent })
        setEditMode(false)
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`${_getApi()}/api/firmware/sketches/${encodeURIComponent(deleteTarget)}`, {
        method: "DELETE",
        credentials: "include",
        headers: _bH(),
      })
      setSketches(prev => prev.filter(s => s.name !== deleteTarget))
      setDeleteTarget(null)
    } catch { /* ignore */ }
    setDeleting(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("sensor_type", "unknown")
      const res = await fetch(`${_getApi()}/api/firmware/upload-sketch`, {
        method: "POST",
        credentials: "include",
        headers: _bH(),
        body: fd,
      })
      if (res.ok) await fetchSketches()
    } catch { /* ignore */ }
    setUploading(false)
    e.target.value = ""
  }

  const sensorBadge = (type: string) => {
    if (type === "ld2450") return <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-400">LD2450</Badge>
    if (type === "c4001") return <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">C4001</Badge>
    return <Badge variant="outline" className="text-[9px]">Custom</Badge>
  }

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              Firmwares ({sketches.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer">
                <input type="file" accept=".ino,.cpp,.c" onChange={handleUpload} className="hidden" />
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" asChild disabled={uploading}>
                  <span>
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    Importer
                  </span>
                </Button>
              </label>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="pt-0">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sketches.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Aucun firmware disponible</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sketches.map(s => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{s.name}</p>
                        <p className="text-[10px] text-muted-foreground">{s.file}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {sensorBadge(s.sensor_type)}
                      {s.is_template && (
                        <Badge variant="secondary" className="text-[9px]">Template</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleView(s.name)}
                        title="Voir / Modifier"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(s.name)}
                        title="Supprimer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* View / Edit Dialog */}
      <Dialog open={!!viewSketch || loadingContent} onOpenChange={(o) => { if (!o) { setViewSketch(null); setEditMode(false) } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              {viewSketch?.name || "Chargement..."}
              {viewSketch && (
                <Badge variant="outline" className="text-[9px] ml-2">{viewSketch.file}</Badge>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">Code source du firmware</DialogDescription>
          </DialogHeader>

          {loadingContent ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : viewSketch ? (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {!editMode ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { setEditMode(true); setEditContent(viewSketch.content) }}>
                      <Pencil className="h-3 w-3" /> Modifier
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1.5" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Enregistrer
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => setEditMode(false)}>
                        <X className="h-3 w-3" /> Annuler
                      </Button>
                    </>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {(editMode ? editContent : viewSketch.content).split("\n").length} lignes
                </span>
              </div>

              <div className="flex-1 min-h-0 rounded-md border border-border/50 bg-background overflow-auto">
                {editMode ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    spellCheck={false}
                    className={cn(
                      "w-full h-full min-h-[400px] p-3 text-[11px] font-mono leading-5",
                      "bg-transparent text-foreground resize-none outline-none",
                      "selection:bg-primary/20"
                    )}
                  />
                ) : (
                  <pre className="p-3 text-[11px] font-mono leading-5 text-foreground/90 whitespace-pre overflow-x-auto">
                    {viewSketch.content}
                  </pre>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Supprimer le firmware</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {"Etes-vous sur de vouloir supprimer"} <span className="font-semibold text-foreground">{deleteTarget}</span> ?
              Cette action est irreversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>Annuler</Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
