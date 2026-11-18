import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import { CloudSyncProvider } from "@/components/sync/cloud-sync-provider";
import { AuthGate } from "@/components/auth/auth-gate";

export const metadata: Metadata = {
  title: {
    default: "ArkaTasks",
    template: "%s · ArkaTasks",
  },
  description: "Cleaning schedule management for DClean",
  applicationName: "ArkaTasks",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ArkaTasks",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#ea580c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AuthGate>
          <CloudSyncProvider>
            <div className="min-h-screen bg-slate-50">
              <Sidebar />
              <MobileNav />
              <main className="lg:pl-64">
                <div className="p-4 md:p-8">{children}</div>
              </main>
            </div>
          </CloudSyncProvider>
        </AuthGate>
      </body>
    </html>
  );
}
