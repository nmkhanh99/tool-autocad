/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",              // sinh HTML/JS tĩnh vào out/ để daemon phục vụ khi đóng gói
  images: { unoptimized: true },
  transpilePackages: ["@acad/cadweb"],
};
export default nextConfig;
