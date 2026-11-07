import { resolve } from "node:path";
import { defineConfig } from "vite";

// In dev, /play?room=ABCD should serve play.html (FastAPI will do this in prod).
const playRoute = {
  name: "play-route",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url.split("?")[0] === "/play") {
        req.url = req.url.replace("/play", "/play.html");
      }
      next();
    });
  },
};

export default defineConfig({
  root: "client",
  plugins: [playRoute],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:8000", ws: true },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: { input: [resolve("client/index.html"), resolve("client/play.html")] },
  },
});
