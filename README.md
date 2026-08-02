# Spiral Bloom Arcade

一个可以用鼠标、触控或键盘游玩的万花轮网页游戏。齿轮按照真实万花尺关系滚动，轨迹随操作持续生长；实时手速会驱动 RPM、跑车声浪和全屏霓虹反馈。

线上地址：<https://spiral.agentclub.dev>

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

打开开发服务器输出的本地地址即可游玩。

## 验证

```bash
npm run build
```

项目基于 React、Next.js、vinext 和 Cloudflare Workers 兼容构建。
