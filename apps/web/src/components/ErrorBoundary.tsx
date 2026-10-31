import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in workspace view:', error, errorInfo)
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center bg-surface-card rounded-lg border border-border-subtle shadow-xl m-8">
          <div className="w-16 h-16 rounded-full bg-on-air-crimson/20 border border-on-air-crimson flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-on-air-crimson text-3xl">warning</span>
          </div>
          <h2 className="text-xl font-bold text-on-surface mb-2 font-headline-md">
            Falha ao renderizar a tela
          </h2>
          <p className="text-sm text-outline max-w-md mb-6 font-body-sm">
            Ocorreu uma falha inesperada durante a exibição desta área. O servidor continua operando no ar.
          </p>
          <div className="w-full max-w-2xl bg-surface-container-lowest p-4 rounded text-left font-mono text-xs text-on-surface-variant overflow-x-auto mb-6 border border-border-subtle">
            <p className="text-on-air-crimson font-bold">{this.state.error?.name}: {this.state.error?.message}</p>
            {this.state.error?.stack && (
              <pre className="mt-2 text-outline text-[11px] whitespace-pre-wrap">{this.state.error.stack}</pre>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-primary text-on-primary rounded font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Recarregar Tela
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
              className="px-6 py-2 bg-surface-panel text-on-surface rounded font-semibold text-sm hover:bg-surface-container border border-border-subtle transition-colors"
            >
              Tentar Novamente
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
