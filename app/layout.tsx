import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Shell from "@/app/ui/shell";
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
  title: "Agentic OS",
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
        <Shell activity={activity} console={consolePanel}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
