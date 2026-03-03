"use client"

import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[v0] ErrorBoundary caught:", error.message, errorInfo.componentStack)

    // Auto-reload on ChunkLoadError (stale cache after rebuild)
    if (error.name === "ChunkLoadError" || error.message?.includes("Failed to load chunk")) {
      window.location.reload()
      return
    }

    // Auto-retry once for Leaflet "already initialized" errors (transient HMR issue)
    if (
      error.message?.includes("already initialized") &&
      this.state.retryCount < 1
    ) {
      setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
        }))
      }, 800)
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, retryCount: this.state.retryCount + 1 })
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
              <button
                onClick={this.handleRetry}
                className="mt-2 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          </div>
        )
      )
    }
    return this.props.children
  }
}
