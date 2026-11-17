import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Suspense } from "react";
import { Nav, NavView } from "@/components/nav";
import "./globals.css";

// Schibsted Grotesk: a clean grotesk made for a media publisher (reason in DESIGN.md).
const appFont = Schibsted_Grotesk({ variable: "--font-app", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Dapur Konten", template: "%s · Dapur Konten" },
  description: "Where your content gets made: ideas, scripts, publishing and what's working, for every IP you produce.",
  applicationName: "Dapur Konten",
  appleWebApp: { capable: true, title: "Dapur Konten", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1530" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${appFont.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="md:flex">
          <Suspense fallback={<NavView pathname="" />}>
            <Nav />
          </Suspense>
          <main className="min-w-0 flex-1 px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] md:px-8 md:pb-10 md:pt-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
