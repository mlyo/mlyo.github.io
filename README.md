# DNSProxyIP Frontend - GitHub Pages Source

这是静态前端源站仓库。它需要部署到 GitHub Pages，例如：

```txt
https://mlyo.github.io
```

用户日常不需要直接访问这个地址。Cloudflare Worker 会通过 `/admin/` 代理这个静态前端：

```txt
https://你的-worker.workers.dev/admin/
```

## 关键点

`vite.config.js` 使用：

```js
export default defineConfig({
  base: './'
});
```

这样构建后的资源路径是相对路径，既能在 GitHub Pages 上托管，也能被 Worker 挂载到 `/admin/` 下使用。

## 本地运行

```bash
npm install
npm run dev
```

## GitHub Pages 部署

1. 上传本仓库到 `mlyo.github.io` 对应的 GitHub 仓库，或其他 Pages 仓库。
2. 打开：

```txt
Settings → Pages → Source → GitHub Actions
```

3. 推送到 `main` 后自动构建并部署。

## API 地址逻辑

- 通过 Worker `/admin/` 访问时，前端默认使用当前 Worker 域名作为 API 地址。
- 直接打开 GitHub Pages 源站时，需要在页面里手动填写 Worker API 地址。
