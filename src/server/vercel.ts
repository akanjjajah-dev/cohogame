import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './app.ts';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const vercelOriginal =
    req.headers['x-vercel-original-url'] || req.headers['x-forwarded-uri'];
  if (
    typeof vercelOriginal === 'string' &&
    vercelOriginal.startsWith('/api/') &&
    (!req.url || req.url === '/api/index' || req.url.startsWith('/api/index?'))
  ) {
    req.url = vercelOriginal;
  } else if (typeof req.url === 'string' && req.url.includes('__path=')) {
    const parsed = new URL(req.url, 'http://localhost');
    const pathParam = parsed.searchParams.get('__path');
    if (pathParam) {
      parsed.searchParams.delete('__path');
      const qs = parsed.searchParams.toString();
      const normalized = pathParam.startsWith('/api/')
        ? pathParam
        : `/api/${pathParam.replace(/^\/+/, '')}`;
      req.url = `${normalized}${qs ? `?${qs}` : ''}`;
    }
  }

  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
