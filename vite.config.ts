import { defineConfig } from 'vite';

// base を './' にすると、GitHub Pages のサブパス (https://<user>.github.io/pocket-legion/) でも
// ローカルの preview でも同じビルド成果物が動く。
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
  },
});
