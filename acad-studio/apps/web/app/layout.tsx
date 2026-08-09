import type { Metadata } from "next";
// Hai hệ CSS sống song song tới giai đoạn 10. Cả hai gate reset của mình bằng
// attribute trên <body> (data-legacy / data-ds) nên không đè lên nhau; thứ tự
// import ở đây không quyết định gì, giữ legacy trước cho khớp lịch sử file.
import "./globals.css";
import "./design-system.css";

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
