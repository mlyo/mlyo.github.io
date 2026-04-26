# DNSProxyIP Frontend

独立前端仓库，可部署到 GitHub Pages。前端只负责页面展示和调用 Worker API，不保存 Cloudflare 密钥。

## 使用

页面打开后填写：

```txt
Worker API 地址：https://你的-worker.workers.dev
AUTH_KEY：后端 Worker 环境变量 AUTH_KEY
```

保存后即可管理 IP 池、检测 ProxyIP、执行维护、查看状态。

## 本地运行

```bash
npm install
npm run dev
```

## GitHub Pages 部署

1. 新建 GitHub 仓库，例如：`dnsproxyip-frontend`
2. 上传本仓库所有文件
3. 修改 `vite.config.js`：

```js
export default defineConfig({
  base: '/dnsproxyip-frontend/'
});
```

仓库名是什么，`base` 就改成 `/<仓库名>/`。

4. GitHub 仓库设置：

```txt
Settings → Pages → Source → GitHub Actions
```

5. 推送到 `main` 后会自动部署。

## 后端 CORS

后端 Worker 的 `ALLOWED_ORIGINS` 要填 GitHub Pages 的 Origin：

```txt
https://你的用户名.github.io
```

不要带仓库路径。
