import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner"
import { UIProvider } from "@/components/providers/UIProvider";
import { getCurrentUser } from "@/app/actions/crm";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Magnivo AI",
  description: "Magnivo AI — the AI-powered CRM for modern sales teams.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Root layout: getCurrentUser failed', e)
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline blocking script: apply saved theme BEFORE hydration to avoid flash */}
        <script dangerouslySetInnerHTML={{
          __html: `
          (function() {
            try {
              var s = localStorage.getItem('crm-appearance');
              if (s) {
                var p = JSON.parse(s);
                var t = p.color_theme || 'white';
                document.documentElement.setAttribute('data-color-theme', t);
                if (t !== 'white') {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              }
            } catch(e) {}
          })();
        `}} />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, dark-mode tools) inject style/attributes onto <body> before
          React hydrates, which is harmless but otherwise logs a mismatch. */}
      <body suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <UIProvider initialSettings={user?.appearance_settings}>
          {children}
          <Toaster />
        </UIProvider>
      </body>
    </html>
  );
}
