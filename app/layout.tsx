import type { Metadata } from "next";
import "./globals.css";
import "./accounting-theme.css";
import { AuthProvider } from "./components/AuthProvider";

export const metadata: Metadata = {
  title: "Bansil Engineers — Reconciliation & Analytics",
  description:
    "Bansil Engineers Analytics: Purchase-Sales Reconciliation powered by local SQLite. Zoho Books read-only integration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body>
        <AuthProvider>
          <div className="app-shell">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
