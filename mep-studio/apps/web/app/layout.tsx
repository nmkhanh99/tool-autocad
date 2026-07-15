import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MEP Studio — Trợ lý AutoCAD",
  description: "Khung chat điều khiển tool AutoCAD MEP qua CLI agent local",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
