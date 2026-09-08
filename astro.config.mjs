// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Domeniul oficial; adresele absolute pornesc de aici.
  site: 'https://ai.dumitru.cloud',
  output: 'server',
  // Fara sesiuni Astro: identitatea vine din Cloudflare Access, iar adaptorul ar cere altfel
  // un namespace KV ("SESSION") la deploy. Fara procesare de imagini (nu folosim <Image>).
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
});
