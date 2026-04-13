import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['sharp', 'tesseract.js', 'pdf-to-img']
  },
  serverExternalPackages: ['sharp', 'tesseract.js', 'pdf-to-img']
};

export default nextConfig;
