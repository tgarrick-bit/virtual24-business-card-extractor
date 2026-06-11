import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "West End Card Scanner",
  description: "Scan business cards and push contacts straight into the ATS Tracker.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/we-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/we-icon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/we-icon-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e31c79",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
