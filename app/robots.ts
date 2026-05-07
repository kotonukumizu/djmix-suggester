import type { MetadataRoute } from "next";

const SITE_URL = "https://djmix-suggester.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Block crawlers from hammering API endpoints (no SEO value, costs us quota)
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
