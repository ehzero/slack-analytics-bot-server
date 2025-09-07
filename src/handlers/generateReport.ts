import { OpenAIService } from "../services/openaiService";
import { SlackService } from "../services/slackService";
import { fetchSummaryJsonFromDb } from "../services/dataService";

// 데이터 분석 보고서를 생성하고 채널에 게시하는 핸들러
export async function generateAnalyticsReport() {
  // 보고서에 사용할 데이터(JSON) 조회
  const dataJson = await fetchSummaryJsonFromDb();

  // 보고서 생성용 시스템 프롬프트
  const systemPrompt = process.env.OPENAI_REPORT_SYSTEM_PROMPT || "";

  const openai = new OpenAIService({
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5-nano",
  });

  const slack = new SlackService(process.env.SLACK_BOT_TOKEN || "");
  const channel = process.env.REPORT_CHANNEL_ID || "";

  try {
    const reportText = await openai.summarizeJsonReport({
      dataJson,
      systemPrompt,
    });

    // Slack 채널로 보고서 전송
    await slack.postMessage({ channel, text: reportText });
  } catch (e: any) {
    await slack.postMessage({
      channel,
      text: `데이터 분석 보고서 작성에 실패했습니다. 잠시 후 다시 시도해주세요.\n에러: ${
        e?.message || e
      }`,
    });
  }

  return { status: "ok" };
}
