import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getVolleyballMatches } from "./services/volleyballService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.join(__dirname, "..", "web");

app.use(cors());
app.use(express.json());
app.use(express.static(webDir));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "ЕБЕЙШИЙ МЯЧ",
    version: "0.1.0",
    time: new Date().toISOString()
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    title: "ЕБЕЙШИЙ МЯЧ",
    version: "0.1 AUTO",
    mode: "demo-engine",
    updatedAt: new Date().toISOString(),
    note: "Стартовый движок работает. Дальше подключаем реальные API и расширяем матмодели."
  });
});

app.get("/api/matches", async (req, res) => {
  try {
    const filter = req.query.filter || "all";
    const matches = await getVolleyballMatches({ filter });

    res.json({
      ok: true,
      count: matches.length,
      updatedAt: new Date().toISOString(),
      matches
    });
  } catch (error) {
    console.error("/api/matches error:", error);
    res.status(500).json({
      ok: false,
      error: "Не удалось собрать матчи",
      details: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(webDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🏐 ЕБЕЙШИЙ МЯЧ запущен на порту ${PORT}`);
});
