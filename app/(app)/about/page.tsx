"use client"

import { TheiaFooter } from "@/components/theia-footer"

export default function AboutPage() {
  return (
    <main className="flex-1 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          {/* Logo radar */}
          <div className="flex flex-col items-center gap-6 mb-10">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/5 blur-2xl scale-150" />
              <svg
                viewBox="0 0 300 300"
                className="relative h-28 w-28 text-primary drop-shadow-[0_0_24px_rgba(34,197,94,0.25)]"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="150" cy="150" r="130" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
                <circle cx="150" cy="150" r="100" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
                <circle cx="150" cy="150" r="70" stroke="currentColor" strokeWidth="2" opacity="0.5" />
                <circle cx="150" cy="150" r="40" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                {/* Sweep line */}
                <line x1="150" y1="150" x2="250" y2="110" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                {/* Center dot */}
                <circle cx="150" cy="150" r="6" fill="currentColor" />
                {/* Target blip */}
                <circle cx="215" cy="125" r="4" fill="currentColor" opacity="0.8">
                  <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite" />
                </circle>
              </svg>
            </div>

            <div className="text-center space-y-1">
              <h1 className="text-3xl font-bold tracking-[0.3em] text-foreground font-mono">
                THEIA
              </h1>
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Hub Control
              </p>
            </div>
          </div>

          {/* Tagline */}
          <div className="text-center mb-10">
            <p className="text-base italic text-primary/90 leading-relaxed font-light">
              {"La ou l'oeil est aveugle, l'onde revele."}
            </p>
          </div>

          {/* Separator */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex-1 h-px bg-border/40" />
            <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
            <div className="flex-1 h-px bg-border/40" />
          </div>

          {/* Description */}
          <div className="space-y-5 text-sm text-muted-foreground leading-relaxed text-center px-2">
            <p>
              {"A l'image de Theia, Titanide de la lumiere et de la vision, l'application incarne la capacite de voir au-dela du perceptible."}
            </p>
            <p>
              {"Comme la mere du Soleil et de la Lune eclaire le monde, THEIA revele ce que l'ombre dissimule et transforme l'invisible en connaissance."}
            </p>
          </div>

          {/* Separator */}
          <div className="flex items-center gap-4 mt-10 mb-8">
            <div className="flex-1 h-px bg-border/40" />
            <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
            <div className="flex-1 h-px bg-border/40" />
          </div>

          {/* Contact & License */}
          <div className="text-center space-y-3">
            <p className="text-xs text-muted-foreground/70 tracking-wider">
              {"(c) 2026 Yoann ETE"}
            </p>
            <a
              href="mailto:theiahub.contact@gmail.com"
              className="inline-block text-xs text-primary/70 hover:text-primary transition-colors tracking-wide"
            >
              theiahub.contact@gmail.com
            </a>
          </div>
        </div>
      </div>
      <TheiaFooter />
    </main>
  )
}
