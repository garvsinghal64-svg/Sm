/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
export const PORT = Number(process.env.APP_PORT || process.env.PORT || 3000);

// Production & dev proxy for Yahoo Finance Chart API
app.use('/api/yahoo', async (req, res) => {
  try {
    const targetUrl = `https://query1.finance.yahoo.com${req.url}`;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
      },
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      // Do not forward hop-by-hop or encoding headers that fetch decompressed
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const body = await response.text();
    res.send(body);
  } catch (err: any) {
    res.status(502).json({
      error: 'Proxy Error',
      message: err.message || 'Failed to reach Yahoo Finance',
    });
  }
});

// Production & dev proxy for Public RSS News (Google News RSS - zero cost)
app.use('/api/rss', async (req, res) => {
  try {
    const targetUrl = `https://news.google.com${req.url}`;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });

    res.status(response.status);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    const body = await response.text();
    res.send(body);
  } catch (err: any) {
    res.status(502).json({
      error: 'Proxy Error',
      message: err.message || 'Failed to reach News RSS feed',
    });
  }
});

// Serve static assets from dist directory in production
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback: return index.html for any non-API navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Only start listening when executed directly as entrypoint
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.ts') ||
  process.argv[1].endsWith('server.js')
);

if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`Indian Stock Market App running on port ${PORT}`);
  });
}

export default app;
