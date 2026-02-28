"use client"

export function TheiaWatermark() {
  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-0 opacity-[0.06] select-none"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 300 300"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[200px] w-[200px] text-foreground"
      >
        <circle cx="150" cy="150" r="100" stroke="currentColor" strokeWidth="4" fill="none" />
        <circle cx="150" cy="150" r="60" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6" />
        <line x1="150" y1="150" x2="230" y2="120" stroke="currentColor" strokeWidth="3" />
        <circle cx="150" cy="150" r="10" fill="currentColor" />
        <text x="150" y="280" textAnchor="middle" fill="currentColor" fontFamily="Arial" fontSize="26" letterSpacing="5">
          THEIA
        </text>
      </svg>
    </div>
  )
}
