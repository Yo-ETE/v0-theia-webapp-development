"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Users,
  Plus,
  Trash2,
  Shield,
  Eye,
  Loader2,
  UserPlus,
  KeyRound,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth-context"

interface UserInfo {
  id: number
  username: string
  role: "admin" | "viewer"
  created_at: string
  last_login: string | null
}

function getBackendUrl(path: string): string {
  if (typeof window === "undefined") return `/api${path}`
  return `http://${window.location.hostname}:8000/api${path}`
}

export function UserManagement() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newRole, setNewRole] = useState<"admin" | "viewer">("viewer")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [changingPassword, setChangingPassword] = useState<number | null>(null)
  const [newPw, setNewPw] = useState("")
  const [deleting, setDeleting] = useState<number | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(getBackendUrl("/auth/users"), { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleCreate = async () => {
    setError(null)
    setSuccess(null)
    setCreating(true)
    try {
      const res = await fetch(getBackendUrl("/auth/users"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Erreur" }))
        throw new Error(data.detail || "Erreur creation")
      }
      setSuccess(`Compte "${newUsername}" cree`)
      setNewUsername("")
      setNewPassword("")
      setNewRole("viewer")
      setShowCreate(false)
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (userId: number) => {
    setError(null)
    setDeleting(userId)
    try {
      const res = await fetch(getBackendUrl(`/auth/users/${userId}`), {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Erreur" }))
        throw new Error(data.detail || "Erreur suppression")
      }
      setSuccess("Compte supprime")
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    } finally {
      setDeleting(null)
    }
  }

  const handleChangePassword = async (userId: number) => {
    setError(null)
    try {
      const res = await fetch(getBackendUrl(`/auth/users/${userId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPw }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Erreur" }))
        throw new Error(data.detail || "Erreur")
      }
      setSuccess("Mot de passe modifie")
      setChangingPassword(null)
      setNewPw("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    }
  }

  const handleToggleRole = async (userId: number, currentRole: string) => {
    setError(null)
    const newR = currentRole === "admin" ? "viewer" : "admin"
    try {
      const res = await fetch(getBackendUrl(`/auth/users/${userId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newR }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Erreur" }))
        throw new Error(data.detail || "Erreur")
      }
      fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur")
    }
  }

  // Clear messages after 4s
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(null); setSuccess(null) }, 4000)
      return () => clearTimeout(t)
    }
  }, [error, success])

  return (
    <Card>
      <CardHeader className="cursor-default">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Comptes utilisateurs
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Nouveau
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Messages */}
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-xs text-primary bg-primary/10 rounded-md px-3 py-2">{success}</p>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="rounded-md border border-border/50 bg-muted/20 p-4 flex flex-col gap-3">
            <p className="text-xs font-medium text-foreground flex items-center gap-2">
              <UserPlus className="h-3.5 w-3.5 text-primary" />
              Creer un compte
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Identifiant</Label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="nom"
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Mot de passe</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="****"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Role :</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewRole("viewer")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs border transition-colors ${
                    newRole === "viewer"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary/50"
                  }`}
                >
                  <Eye className="h-3 w-3" />
                  Visualisateur
                </button>
                <button
                  type="button"
                  onClick={() => setNewRole("admin")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs border transition-colors ${
                    newRole === "admin"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary/50"
                  }`}
                >
                  <Shield className="h-3 w-3" />
                  Admin
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
              <Button
                size="sm"
                disabled={creating || !newUsername || !newPassword}
                onClick={handleCreate}
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Creer"}
              </Button>
            </div>
          </div>
        )}

        {/* Users list */}
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Aucun compte</p>
        ) : (
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-col rounded-md border border-border/50 bg-muted/10">
                <div className="flex items-center gap-3 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary shrink-0">
                    {u.role === "admin" ? (
                      <Shield className="h-4 w-4 text-primary" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{u.username}</span>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[9px] uppercase">
                        {u.role}
                      </Badge>
                      {u.id === currentUser?.id && (
                        <Badge variant="outline" className="text-[9px]">vous</Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {u.last_login ? `Derniere connexion: ${u.last_login}` : "Jamais connecte"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {u.id !== currentUser?.id && (
                      <>
                        <button
                          onClick={() => handleToggleRole(u.id, u.role)}
                          className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                          title={`Changer en ${u.role === "admin" ? "viewer" : "admin"}`}
                        >
                          {u.role === "admin" ? <Eye className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDelete(u.id)}
                          disabled={deleting === u.id}
                          className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Supprimer"
                        >
                          {deleting === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setChangingPassword(changingPassword === u.id ? null : u.id); setNewPw("") }}
                      className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                      title="Changer mot de passe"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {changingPassword === u.id && (
                  <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2 bg-muted/20">
                    <Input
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="Nouveau mot de passe"
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={!newPw || newPw.length < 4}
                      onClick={() => handleChangePassword(u.id)}
                    >
                      Enregistrer
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
