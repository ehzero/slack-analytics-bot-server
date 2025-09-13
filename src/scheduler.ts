import * as cron from "node-cron";
import { generateAnalyticsReport } from "./handlers/generateReport";

export function startScheduler() {
  // 기본 스케줄: 매주 일요일 23:00 UTC (월요일 08:00 KST)
  const scheduleExpression = process.env.SCHEDULE_EXPRESSION || "0 23 * * 0";

  console.log(`📅 Scheduling weekly report with cron: ${scheduleExpression}`);

  // 주간 보고서 스케줄 등록
  cron.schedule(
    scheduleExpression,
    async () => {
      console.log("⏰ Starting weekly analytics report generation...");

      try {
        await generateAnalyticsReport();
        console.log("✅ Weekly analytics report completed successfully");
      } catch (error) {
        console.error("❌ Weekly analytics report failed:", error);
      }
    },
    {
      timezone: "UTC",
    }
  );

  // 개발/테스트용 즉시 실행 옵션
  if (process.env.RUN_REPORT_ON_START === "true") {
    console.log("🧪 Running initial report due to RUN_REPORT_ON_START=true");

    setTimeout(async () => {
      try {
        await generateAnalyticsReport();
        console.log("✅ Initial report completed successfully");
      } catch (error) {
        console.error("❌ Initial report failed:", error);
      }
    }, 5000); // 서버 시작 5초 후 실행
  }
}
