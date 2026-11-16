import type { MetadataRoute } from "next";

// Makes the app installable: "Add to Home Screen" on iPhone/Android, "Install app" in Chrome/Edge on desktop.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Studio — Content Platform",
    short_name: "Studio",
    description: "Your personal multi-agent content studio.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0c0c0e",
    theme_color: "#5b5bd6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
