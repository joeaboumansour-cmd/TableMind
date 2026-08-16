"use client";

// Last-resort boundary: catches throws in the root layout itself, which
// error.tsx cannot. It must render its own <html>/<body> because it replaces
// the root layout entirely.
//
// Deliberately dependency-free (no theme tokens, no UI components) — if the
// root layout is what failed, anything it provides may be unavailable.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "22rem" }}>
          <h1 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
            Golden Squirrel POS could not start
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "1.5rem" }}>
            Unsynced sales are still stored on this device.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#f59e0b",
              color: "#0a0a0a",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", opacity: 0.5 }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
