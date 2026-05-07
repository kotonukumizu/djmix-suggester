import { ImageResponse } from "next/og";

// Dynamic OG image for social sharing (Twitter/Facebook/LINE/Slack)
// Generated at build time as a static PNG.

export const alt =
  "DJ Mix Suggester — BPM・Camelot互換でDJセットリストを自動生成";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(ellipse 70% 60% at 30% 20%, rgba(124,58,237,0.35) 0%, transparent 65%), linear-gradient(135deg, #050510 0%, #0d0820 100%)",
          color: "white",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "4px",
            background:
              "linear-gradient(to right, transparent, #a855f7, transparent)",
          }}
        />

        {/* Logo + brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            marginBottom: "48px",
          }}
        >
          <div
            style={{
              width: "92px",
              height: "92px",
              borderRadius: "24px",
              background:
                "linear-gradient(135deg, #a855f7 0%, #6d28d9 50%, #4c1d95 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 40px rgba(124,58,237,0.55)",
            }}
          >
            <svg
              width="52"
              height="52"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="3" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="21" />
              <line x1="3" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="21" y2="12" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "60px",
              fontWeight: 900,
              letterSpacing: "-0.02em",
              background:
                "linear-gradient(to right, #ffffff 0%, #e9d5ff 60%, #c084fc 100%)",
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
            }}
          >
            DJ Mix Suggester
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "44px",
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            marginBottom: "24px",
            display: "flex",
            color: "#f5f3ff",
          }}
        >
          BPM × Camelotで繋ぐ、
        </div>
        <div
          style={{
            fontSize: "44px",
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            marginBottom: "48px",
            display: "flex",
            color: "#f5f3ff",
          }}
        >
          AI支援のDJセットリスト
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: "14px" }}>
          {[
            "BPM自動解析",
            "Camelot互換",
            "AIブリッジ提案",
          ].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "12px 22px",
                borderRadius: "999px",
                background: "rgba(168,85,247,0.15)",
                border: "1px solid rgba(168,85,247,0.4)",
                color: "#e9d5ff",
                fontSize: "22px",
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* URL footer */}
        <div
          style={{
            position: "absolute",
            bottom: "48px",
            right: "80px",
            fontSize: "22px",
            color: "rgba(168,85,247,0.6)",
            letterSpacing: "0.05em",
            display: "flex",
          }}
        >
          djmix-suggester.vercel.app
        </div>
      </div>
    ),
    { ...size }
  );
}
