import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mupdf ships a WebAssembly build that it loads from its own folder at runtime.
  serverExternalPackages: ["mupdf"],
  outputFileTracingIncludes: {
    "/api/convert": ["./node_modules/mupdf/dist/**"],
  },
};

export default nextConfig;
