import { defineConfig } from 'vite';

// 关键：使用相对路径，保证 GitHub Pages 作为静态源站，
// 同时也能被 Worker 挂载到 /admin/ 下正常加载资源。
export default defineConfig({
  base: './'
});
