import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const PORT = process.env.PORT || 8091;
const CTRL = process.env.CTRL || "http://192.168.2.80:3000";

// Health
app.get("/healthz", (req, res) => res.json({ ok: true, controller: CTRL, time: new Date() }));

// Proxy API
app.use("/api", createProxyMiddleware({
  target: CTRL,
  changeOrigin: true,
  pathRewrite: { "^/api": "" }
}));

// Static files
app.use(express.static("./public"));

app.listen(PORT, () => {
  console.log(`[charlie] running http://127.0.0.1:${PORT} → ${CTRL}`);
});
