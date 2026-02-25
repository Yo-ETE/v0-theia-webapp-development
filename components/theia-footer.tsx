"use client"

export function TheiaFooter() {
  return (
    <footer className="mt-auto border-t border-border/30 bg-background/50 px-4 py-3">
      <div className="flex flex-col items-center gap-0.5">
        <p className="text-[10px] text-muted-foreground tracking-wider">
          THEIA Hub Control v1.0 - &copy; 2026 Yoann ETE
        </p>
        <p className="text-[9px] italic text-muted-foreground/60">
          {"THEIA - La ou l'oeil est aveugle, l'onde revele"}
        </p>
      </div>
    </footer>
  )
}
