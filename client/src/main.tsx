import { createRoot } from "react-dom/client";
import { initBrowserOtel } from "./lib/otel";
import App from "./App";
import "./index.css";
// Initialize i18n
import "./i18n";

// Initialize OpenTelemetry BEFORE React renders
// This ensures fetch instrumentation is ready for all API calls
// Wrapped in try-catch so OTEL failures never crash the application
try {
    initBrowserOtel();
} catch (e) {
    console.warn('[OTEL] Failed to initialize browser telemetry:', e);
}

createRoot(document.getElementById("root")!).render(<App />);
