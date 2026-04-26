import { defineConfig } from 'vite';

// 如果仓库名是 dnsproxyip-manager，GitHub Pages 项目站点需要这个 base。
// 如果你部署到用户名根站点 username.github.io，可改成 base: '/'
export default defineConfig({
  base: '/dnsproxyip-manager/'
});
