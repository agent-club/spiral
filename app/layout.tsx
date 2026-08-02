import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://spiral.agentclub.dev"),
  title: "轨迹花园｜拖出一朵几何花",
  description: "一个可以用鼠标或手指拖动游玩的万花尺互动实验。",
  openGraph: {
    title: "Spiral Bloom Arcade",
    description: "转动真实万花轮，让速度、跑车声浪与霓虹花轨一起盛放。",
    images: [{ url: "/og.png", width: 1736, height: 909, alt: "Spiral Bloom Arcade" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spiral Bloom Arcade",
    description: "转动真实万花轮，让速度、跑车声浪与霓虹花轨一起盛放。",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
