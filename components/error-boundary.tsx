"use client"

import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[v0] ErrorBoundary caught:", error.message, errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="text-center">
              <p className="text-xs font-mono text-destructive">Component Error</p>
              <p className="mt-1 text-[10px] text-muted-foreground max-w-xs truncate">
                {this.state.error?.message}
              </p>
            </div>
          </div>
        )
      )
    }
    return this.props.children
  }
}
