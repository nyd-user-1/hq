import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Boundary from "@/app/ui/boundary";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HQ",
  description: "Portfolio dashboard over the HQ vault",
};

export default function RootLayout({
  children,
  activity,
  console: consolePanel,
}: Readonly<{
  children: React.ReactNode;
  activity: React.ReactNode;
  console: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 p-4 lg:p-6">
          <header className="flex items-baseline gap-3 px-1">
            <h1 className="text-lg font-semibold tracking-tight">HQ</h1>
            <p className="text-sm text-zinc-500">
              one vault · every project · localhost only
            </p>
          </header>
          <Boundary label="layout.tsx">
            <div className="grid flex-1 items-start gap-5 lg:grid-cols-3">
              <div className="order-2 flex min-w-0 lg:order-1 lg:col-span-2 lg:row-span-2">
                {children}
              </div>
              <div className="order-1 flex min-w-0 lg:order-2">{activity}</div>
              <div className="order-3 flex min-w-0">{consolePanel}</div>
            </div>
          </Boundary>
        </div>
      </body>
    </html>
  );
}
