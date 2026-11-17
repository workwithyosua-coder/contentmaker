import type { MetadataRoute } from "next";

// Makes the app installable: "Add to Home Screen" on iPhone/Android, "Install app" in Chrome/Edge on desktop.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dapur Konten",
    short_name: "Dapur Konten",
    description: "Where your content gets made: ideas, scripts, publishing and what's working, for every IP you produce.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b1530",
    theme_color: "#0e1a3a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
