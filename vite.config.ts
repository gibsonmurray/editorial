import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"
import pkg from "./package.json"

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
        tailwindcss(),
        react(),
        VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            includeAssets: [
                "icons/editorial.svg",
                "icons/icon-192.png",
                "icons/icon-512.png",
                "icons/maskable-512.png",
                "icons/apple-touch-icon.png",
            ],
            manifest: {
                name: "Editorial",
                short_name: "Editorial",
                description:
                    "An editor in residence for drafting, reviewing, and refining manuscripts.",
                id: "/",
                start_url: "/",
                scope: "/",
                display: "standalone",
                display_override: [
                    "window-controls-overlay",
                    "standalone",
                    "minimal-ui",
                ],
                background_color: "#F4EFE6",
                theme_color: "#EDE8DD",
                orientation: "any",
                categories: ["productivity", "utilities", "writing"],
                icons: [
                    {
                        src: "/icons/editorial.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "any",
                    },
                    {
                        src: "/icons/icon-192.png",
                        sizes: "192x192",
                        type: "image/png",
                        purpose: "any",
                    },
                    {
                        src: "/icons/icon-512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "any",
                    },
                    {
                        src: "/icons/maskable-512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "maskable",
                    },
                ],
            },
            workbox: {
                navigateFallback: "/",
                globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
            },
        }),
    ],
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
})
