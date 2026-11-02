import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadConfig } from './config'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function Failure({ title, error, hint }: { title: string; error: unknown; hint?: string }) {
  return (
    <main className="config-error">
      <h1>{title}</h1>
      <p>{message(error)}</p>
      {hint && <p>{hint}</p>}
    </main>
  )
}

// A throw while App renders (a malformed stored keeper key, say) would otherwise leave a blank page. It can come at start
// or later, so the title does not claim the app never started.
class Guard extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('unknown error') }
  }

  render() {
    return this.state.error ? (
      <Failure title="Something went wrong" error={this.state.error} hint="Reload the page; if it persists, check the log or .env." />
    ) : (
      this.props.children
    )
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement)
try {
  root.render(
    <Guard>
      <App config={loadConfig(import.meta.env)} />
    </Guard>,
  )
} catch (err) {
  root.render(<Failure title="Setup needed" error={err} />)
}
