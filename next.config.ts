import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'tesseract.js', 'pdf-to-img'],
  env: { NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL }
};

export default nextConfig;
