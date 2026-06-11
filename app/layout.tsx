import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

function Slot({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-xl border border-dashed border-zinc-700 p-5">
      <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      {children}
    </section>
  );
}

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
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 lg:p-6">
          <header className="flex items-baseline gap-3 px-1">
            <h1 className="text-lg font-semibold tracking-tight">HQ</h1>
            <p className="text-sm text-zinc-500">
              one vault · every project · localhost only
            </p>
          </header>
          <div className="grid flex-1 items-start gap-4 lg:grid-cols-3">
            <div className="flex lg:col-span-2">
              <Slot label="Portfolio">{children}</Slot>
            </div>
            <div className="flex flex-col gap-4">
              <Slot label="@activity">{activity}</Slot>
              <Slot label="@console">{consolePanel}</Slot>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
