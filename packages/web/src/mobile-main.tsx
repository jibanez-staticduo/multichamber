import { createConfiguredWebAPIs } from './runtimeConfig';
import type { RuntimeAPIs } from '@multichamber/ui/lib/api/types';
import '@multichamber/ui/index.css';
import '@multichamber/ui/styles/fonts';
import '@multichamber/ui/styles/katex-css';

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

window.__OPENCHAMBER_RUNTIME_APIS__ = createConfiguredWebAPIs();

void import('@multichamber/ui/apps/renderMobileApp')
  .then(({ renderMobileApp }) => {
    renderMobileApp(window.__OPENCHAMBER_RUNTIME_APIS__ ?? createConfiguredWebAPIs());
  });
