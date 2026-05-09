import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { LanguageProvider } from "@/lib/i18n";
import { PostHogProvider } from "@/lib/posthog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://djmix-suggester.vercel.app";
const SITE_NAME = "DJ Mix Suggester";
const DESCRIPTION =
  "好きな曲を選ぶだけで、BPMとCamelot（ハーモニック）互換のブリッジ曲を自動提案。スムーズに繋がるDJミックスのセットリストを生成します。";

export const viewport: Viewport = {
  themeColor: "#080810",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — BPM・Camelot互換でDJセットリストを自動生成`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  generator: "Next.js",
  keywords: [
    "DJ",
    "DJミックス",
    "DJ mix",
    "ブリッジ曲",
    "選曲",
    "セットリスト",
    "プレイリスト生成",
    "BPM",
    "BPM 合わせる",
    "Camelot",
    "Camelot wheel",
    "ハーモニックミキシング",
    "harmonic mixing",
    "key matching",
    "DJ ツール",
    "AI DJ",
    "DJ playlist generator",
    "music key detector",
  ],
  category: "music",
  referrer: "origin-when-cross-origin",
  formatDetection: {
    email: false,
    telephone: false,
    address: false,
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — BPM・Camelot互換でDJセットリストを自動生成`,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — BPM・Camelot互換でDJセットリストを自動生成`,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    google: "vl2AuYtUdEVRPRsdof1YHggXbEKE5xCCRTxsZVx1s_c",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  description: DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Any",
  inLanguage: "ja-JP",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "JPY",
  },
  featureList: [
    "BPM自動解析（クライアントサイド音声解析）",
    "Camelotキー（ハーモニックミキシング）互換判定",
    "AIによるブリッジ曲の自動提案",
    "Spotifyプレイリストからの読み込み",
    "iTunes Searchによる楽曲検索",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          // Schema.org JSON-LD: trusted, statically generated string. Safe to inline.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <PostHogProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </PostHogProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
