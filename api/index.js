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
    version: "0.1.0"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    title: "ЕБЕЙШИЙ МЯЧ",
    version: "0.1 AUTO",
    mode: "development"
  });
});

app.get("/api/matches", async (req, res) => {
  try {
    const matches = await getVolleyballMatches({
      filter: req.query.filter || "all"
    });

    res.json({
      ok: true,
      count: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(webDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🏐 ЕБЕЙШИЙ МЯЧ запущен на порту ${PORT}`);
});
