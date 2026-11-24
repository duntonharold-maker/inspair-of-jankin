import type { NextConfig } from "next";

const config: NextConfig = {
  // Media is served as static files; never copy it into serverless functions.
  outputFileTracingExcludes: { "*": ["public/media/**", "content/**"] },
  async headers() {
    return [
      {
        // Uploaded media: never let an SVG run script on this origin, and cache forever
        // (replaced media always gets a new file name).
        source: "/media/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; font-src data:; sandbox",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default config;
