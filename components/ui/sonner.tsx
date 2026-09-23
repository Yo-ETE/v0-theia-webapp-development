'use client'

import { Toaster as Sonner, ToasterProps } from 'sonner'

// THEIA is dark-only (`<html className="dark">` is hard-coded and no ThemeProvider is
// mounted), so asking next-themes for the theme returned undefined and fell back to
// "system" -- which would have rendered a light toast over a dark ops interface.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
