import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Geist: neutra, compacta y con cifras tabulares. Es la letra de un producto
// de trabajo, no de una portada; se lee igual en una tabla de 200 filas.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atlas | CRM",
  description: "Atlas — la suite CRM: leads, ventas, scoring, correo, contact center y WhatsApp en un solo lugar",
  // Instalable en el celular: ícono propio y pantalla completa en iPhone.
  appleWebApp: { capable: true, title: "Atlas", statusBarStyle: "default" },
  icons: { apple: "/iconos/apple-touch-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
