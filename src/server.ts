// 환경변수를 가장 먼저 로드 (다른 import보다 먼저)
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env") });

import express from "express";
import { handleSlackEvents } from "./handlers/slackEventsHandler";
import { startScheduler } from "./scheduler";

const app = express();
const PORT = process.env.PORT || 3000;

// JSON 및 raw body 파싱을 위한 미들웨어
app.use("/slack/events", express.raw({ type: "application/json" }));
app.use(express.json());

// 헬스체크 엔드포인트
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Slack Events API 엔드포인트
app.post("/slack/events", async (req, res) => {
  try {
    const result = await handleSlackEvents(req, res);
    if (!res.headersSent) {
      res.status(result.statusCode).json(result.body);
    }
  } catch (error) {
    console.error("Error handling Slack event:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 Slack Analytics Bot server running on port ${PORT}`);

  // 스케줄러 시작
  startScheduler();
  console.log("📅 Weekly report scheduler started");
});

// 프로세스 종료 시 정리
process.on("SIGTERM", () => {
  console.log("🛑 Server shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Server shutting down...");
  process.exit(0);
});
