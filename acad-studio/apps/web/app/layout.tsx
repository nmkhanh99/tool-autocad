import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Acad Studio — AutoCAD Toolkit",
  description:
    "Shell UI cho AutoCAD Toolkit (Offline · ACAD Control · ObjectARX) — domain-agnostic, điều khiển qua CLI agent local",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
