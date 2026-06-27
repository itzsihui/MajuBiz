import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { agentsRouter } from "./routes/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const isProd = process.env.NODE_ENV === "production";

app.use(cors({ origin: isProd ? false : "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openai: Boolean(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith("sk-...")),
    exa: Boolean(process.env.EXA_API_KEY && !process.env.EXA_API_KEY.startsWith("exa-...")),
  });
});

app.use("/api", agentsRouter);

if (isProd) {
  const clientDist = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`MajuBiz server on http://localhost:${PORT} (${isProd ? "production" : "dev"})`);
});
