import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://tempaco.id',
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  integrations: [sitemap()],
  compressHTML: true,
});
