import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'tesseract.js', 'canvas', 'pdfjs-dist', '@napi-rs/canvas'],
  env: { NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL }
};

export default nextConfig;
