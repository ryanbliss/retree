import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SandpackCSS } from "@/components/site/SandpackCSS";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    metadataBase: new URL("https://retreejs.dev"),
    title: {
        default: "Retree — state that matches your component tree",
        template: "%s | Retree",
    },
    description:
        "Retree is a lightweight React state tree library in TypeScript. Mutate plain objects and classes; exactly the components that read them re-render.",
    openGraph: {
        siteName: "Retree",
        type: "website",
        url: "https://retreejs.dev",
    },
    twitter: {
        card: "summary_large_image",
    },
};

/**
 * Applies the persisted theme before first paint. Dark is the default; only
 * an explicit "light" choice (or light OS preference when no choice is
 * stored) sets the attribute, so there is no flash for either audience.
 */
const themeScript = `(function () {
    try {
        var stored = localStorage.getItem("retree-theme");
        var theme = stored === "light" || stored === "dark"
            ? stored
            : window.matchMedia("(prefers-color-scheme: light)").matches
              ? "light"
              : "dark";
        if (theme === "light") {
            document.documentElement.dataset.theme = "light";
        }
    } catch (e) {}
})();`;

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
                <SandpackCSS />
            </head>
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <SiteNav />
                <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>
                <SiteFooter />
            </body>
        </html>
    );
}
