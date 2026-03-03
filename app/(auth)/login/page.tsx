"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Eye, EyeOff, Loader2, Lock } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

export default function LoginPage() {
  const router = useRouter()
  const { login, user, isLoading: authLoading } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // If already logged in, redirect
  if (user && !authLoading) {
    router.replace("/dashboard")
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await login(username, password)
      router.replace("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Watermark logo bas droite (gris, ancré à l’écran) */}
      <div className="fixed bottom-8 right-8 pointer-events-none select-none z-0 flex flex-col items-center text-muted-foreground opacity-[0.10]">
        <svg
          viewBox="0 0 120 120"
          className="h-40 w-40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="60" cy="60" r="58" stroke="currentColor" strokeWidth="2" />
          <circle cx="60" cy="60" r="40" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="60" cy="60" r="22" stroke="currentColor" strokeWidth="1" />
          <circle cx="60" cy="60" r="6" fill="currentColor" />
          <line
            x1="60"
            y1="60"
            x2="108"
            y2="36"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>

        <div className="mt-2 text-sm font-semibold tracking-[0.35em] font-mono">
          THEIA
        </div>
      </div>

      {/* Contenu (au-dessus du watermark) */}
      <div className="relative z-10 w-full max-w-sm px-4">
        {/* Radar logo (vert) */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="relative">
            <svg
              viewBox="0 0 120 120"
              className="h-20 w-20 text-primary"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="60" cy="60" r="50" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <circle cx="60" cy="60" r="32" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
              <circle cx="60" cy="60" r="14" stroke="currentColor" strokeWidth="1" opacity="0.7" />
              <line x1="60" y1="60" x2="95" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="60" cy="60" r="4" fill="currentColor" />
            </svg>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5">
              <Lock className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-wide text-foreground font-mono">THEIA</h1>
            <p className="text-xs text-muted-foreground mt-1 tracking-wider uppercase">Hub Control</p>
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <p className="text-sm text-muted-foreground text-center">
              Connectez-vous pour acceder au hub
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username" className="text-xs text-muted-foreground uppercase tracking-wider">
                  Identifiant
                </Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="bg-background/50"
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-xs text-muted-foreground uppercase tracking-wider">
                  Mot de passe
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="********"
                    className="bg-background/50 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2 text-center">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={loading || !username || !password} className="w-full mt-1">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col items-center gap-0.5 mt-8">
          <p className="text-[10px] text-muted-foreground tracking-wider">© 2026 Yoann ETE</p>
          <p className="text-[9px] italic text-muted-foreground/60">
            THEIA - La ou l&apos;oeil est aveugle, l&apos;onde revele
          </p>
        </div>
      </div>
    </>
  )
}
