import { Component, StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import App from "./App";
import { PreferencesProvider } from "./components/Preferences";
import "./styles.css";
import "./v2.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal-error">
          <h1>ATLAS needs a refresh.</h1>
          <p>
            The workspace encountered a rendering error. No source data has been
            modified.
          </p>
          <button onClick={() => window.location.reload()}>
            Reload workspace
          </button>
          <a href="/docs">API documentation</a>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </ErrorBoundary>
  </StrictMode>,
);
