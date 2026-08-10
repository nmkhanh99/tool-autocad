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

/** Đặt `data-rail` TRƯỚC lần vẽ đầu tiên.
 *
 * Nếu đợi `useEffect`, thanh điều hướng sẽ nháy từ 232px xuống 64px mỗi lần tải
 * trang với người đang để chế độ thu gọn.
 *
 * Ba chi tiết dễ sai, mỗi cái từng làm hỏng cách làm này ở nơi khác:
 *   · script phải là con ĐẦU TIÊN của <body> — đặt trong <head> thì
 *     `document.body` còn là null và cả khối ném TypeError;
 *   · khối `catch` để TRỐNG — nếu nó cũng ghi DOM thì lỗi thứ hai không ai bắt.
 *     CSS đã có mặc định 232px nên không cần dự phòng;
 *   · `<body suppressHydrationWarning>` vì script sửa attribute trước hydrate.
 */
const RAIL_SCRIPT = `(function(){try{
var p=localStorage.getItem("acad.rail.v1"),w=window.innerWidth;
document.body.dataset.rail=w<900?"collapsed":(p==="collapsed"||p==="expanded"?p:(w<1240?"collapsed":"expanded"));
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: RAIL_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
