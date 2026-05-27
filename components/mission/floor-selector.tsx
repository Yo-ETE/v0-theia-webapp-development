"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Plus, Building2, ChevronDown, Pencil, Trash2, Upload, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Floor } from "@/lib/types"

interface FloorSelectorProps {
  floors: Floor[]
  selectedFloor: number
  onSelectFloor: (level: number) => void
  onAddFloor: (floor: Omit<Floor, "devices" | "device_history">) => void
  onUpdateFloor: (level: number, updates: Partial<Floor>) => void
  onDeleteFloor: (level: number) => void
  onUploadPlan: (level: number, file: File) => Promise<void>
  disabled?: boolean
}

const DEFAULT_FLOOR_LABELS = [
  "Sous-sol", "Rez-de-chaussee", "1er etage", "2eme etage", "3eme etage", "4eme etage", "Combles"
]

export function FloorSelector({
  floors,
  selectedFloor,
  onSelectFloor,
  onAddFloor,
  onUpdateFloor,
  onDeleteFloor,
  onUploadPlan,
  disabled = false,
}: FloorSelectorProps) {
  const [addDialog, setAddDialog] = useState(false)
  const [editDialog, setEditDialog] = useState<Floor | null>(null)
  const [newLabel, setNewLabel] = useState("")
  const [newLevel, setNewLevel] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingFloor, setUploadingFloor] = useState<number | null>(null)

  const sortedFloors = [...floors].sort((a, b) => a.level - b.level)
  const currentFloor = floors.find(f => f.level === selectedFloor)
  
  const handleAddFloor = () => {
    if (!newLabel.trim()) return
    onAddFloor({
      level: newLevel,
      label: newLabel.trim(),
    })
    setAddDialog(false)
    setNewLabel("")
    setNewLevel(floors.length)
  }

  const handleEditFloor = () => {
    if (!editDialog || !newLabel.trim()) return
    onUpdateFloor(editDialog.level, { label: newLabel.trim() })
    setEditDialog(null)
    setNewLabel("")
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || uploadingFloor === null) return
    
    setUploading(true)
    try {
      await onUploadPlan(uploadingFloor, file)
    } finally {
      setUploading(false)
      setUploadingFloor(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const triggerUpload = (level: number) => {
    setUploadingFloor(level)
    fileInputRef.current?.click()
  }

  // If no floors exist yet, show a simple "Add floor" button
  if (floors.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setNewLevel(0)
            setNewLabel("Rez-de-chaussee")
            setAddDialog(true)
          }}
          disabled={disabled}
          className="text-xs"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Ajouter un etage
        </Button>
        
        <AddFloorDialog
          open={addDialog}
          onOpenChange={setAddDialog}
          label={newLabel}
          level={newLevel}
          onLabelChange={setNewLabel}
          onLevelChange={setNewLevel}
          onConfirm={handleAddFloor}
          existingLevels={floors.map(f => f.level)}
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {/* Hidden file input for plan upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Floor tabs */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
        {sortedFloors.map((floor) => (
          <button
            key={floor.level}
            onClick={() => onSelectFloor(floor.level)}
            disabled={disabled}
            className={cn(
              "px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-1.5",
              selectedFloor === floor.level
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Building2 className="h-3 w-3" />
            {floor.label}
            {floor.plan_image && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 ml-1">
                Plan
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled} className="h-8">
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => {
            setNewLevel(Math.max(...floors.map(f => f.level)) + 1)
            setNewLabel(DEFAULT_FLOOR_LABELS[Math.min(floors.length + 1, DEFAULT_FLOOR_LABELS.length - 1)])
            setAddDialog(true)
          }}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Ajouter un etage
          </DropdownMenuItem>
          
          {currentFloor && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => triggerUpload(currentFloor.level)}>
                <Upload className="mr-2 h-3.5 w-3.5" />
                {currentFloor.plan_image ? "Changer le plan" : "Ajouter un plan"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setEditDialog(currentFloor)
                setNewLabel(currentFloor.label)
              }}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Renommer
              </DropdownMenuItem>
              {floors.length > 1 && (
                <DropdownMenuItem 
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeleteFloor(currentFloor.level)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Supprimer
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Add floor dialog */}
      <AddFloorDialog
        open={addDialog}
        onOpenChange={setAddDialog}
        label={newLabel}
        level={newLevel}
        onLabelChange={setNewLabel}
        onLevelChange={setNewLevel}
        onConfirm={handleAddFloor}
        existingLevels={floors.map(f => f.level)}
      />

      {/* Edit floor dialog */}
      <Dialog open={!!editDialog} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Renommer l&apos;etage</DialogTitle>
            <DialogDescription className="text-xs">
              Modifiez le nom de cet etage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nom</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex: 1er etage"
                className="text-sm mt-1"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditDialog(null)}>
              Annuler
            </Button>
            <Button size="sm" onClick={handleEditFloor} disabled={!newLabel.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload indicator */}
      {uploading && (
        <Badge variant="outline" className="text-xs animate-pulse">
          Upload en cours...
        </Badge>
      )}
    </div>
  )
}

function AddFloorDialog({
  open,
  onOpenChange,
  label,
  level,
  onLabelChange,
  onLevelChange,
  onConfirm,
  existingLevels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  level: number
  onLabelChange: (label: string) => void
  onLevelChange: (level: number) => void
  onConfirm: () => void
  existingLevels: number[]
}) {
  const levelConflict = existingLevels.includes(level)
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Ajouter un etage</DialogTitle>
          <DialogDescription className="text-xs">
            Creez un nouvel etage avec son propre plan et capteurs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nom de l&apos;etage</Label>
            <Input
              value={label}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="Ex: 1er etage"
              className="text-sm mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Niveau (ordre d&apos;affichage)</Label>
            <Input
              type="number"
              value={level}
              onChange={(e) => onLevelChange(parseInt(e.target.value) || 0)}
              className="text-sm mt-1 w-24"
            />
            {levelConflict && (
              <p className="text-[10px] text-destructive mt-1">
                Ce niveau existe deja. Choisissez un autre numero.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={!label.trim() || levelConflict}>
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
