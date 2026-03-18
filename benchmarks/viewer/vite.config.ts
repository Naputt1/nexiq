import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    {
      name: 'list-results',
      configureServer(server) {
        server.middlewares.use('/api/results', (req, res) => {
          const resultsDir = path.resolve(__dirname, '../results');
          if (!fs.existsSync(resultsDir)) {
            res.end(JSON.stringify([]));
            return;
          }
          const files = fs.readdirSync(resultsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => `/results/${f}`);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });

        server.middlewares.use('/results', (req, res, next) => {
          const resultsDir = path.resolve(__dirname, '../results');
          const url = new URL(req.url!, `http://${req.headers.host}`);
          const filePath = path.join(resultsDir, url.pathname.replace(/^\//, ''));
          
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath));
          } else {
            next();
          }
        });
      }
    }
  ],
  server: {
    fs: {
      allow: ['..']
    }
  }
});
