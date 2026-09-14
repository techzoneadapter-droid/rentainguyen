import type { Metadata } from "next";
import "./globals.css";
import "./typography-fix.css";

export const metadata: Metadata = {
  title: "Ads Workspace · Quản lý tài nguyên Meta",
  description: "Không gian quản lý BM, tài khoản quảng cáo, Page, Pixel và workflow Meta Ads.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
