/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",              // sinh HTML/JS tĩnh vào out/ để daemon phục vụ khi đóng gói
  // Bắt buộc khi đóng gói: daemon phục vụ out/ bằng express.static (không bật
  // option `extensions`) rồi catch-all về index.html. Không có trailingSlash,
  // Next sinh out/changes.html mà static không tìm ra, nên /changes rơi vào
  // catch-all và trả HTTP 200 với nội dung route "/". next dev che lỗi này.
  // Có trailingSlash: Next sinh out/changes/index.html → serve-static tự
  // redirect 301 /changes → /changes/ rồi phục vụ đúng index.html.
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@acad/cadweb"],
};
export default nextConfig;
