import {
  getOpenAIService,
  getSlackService,
} from "../services/singletonServices";
import { fetchSummaryJsonFromDb } from "../services/dataService";
import { REPORT_SYSTEM_PROMPT } from "../constants/prompts";

// 데이터 분석 보고서를 생성하고 채널에 게시하는 핸들러
export async function generateAnalyticsReport() {
  // 보고서에 사용할 데이터(JSON) 조회
  const jsonData = await fetchSummaryJsonFromDb();

  // 보고서 생성용 시스템 프롬프트는 상수에서 가져옴

  const openai = getOpenAIService();
  const slack = getSlackService();
  const channel = process.env.REPORT_CHANNEL_ID || "";

  try {
    const report = await openai.summarizeJsonReport({
      jsonData,
      systemPrompt: REPORT_SYSTEM_PROMPT,
    });

    const blocks = JSON.parse(report) as any[];

    // Slack 채널로 보고서 전송
    await slack.postMessage({ channel, text: "", blocks });

    // 원천 데이터를 JSON 파일로 업로드
    await slack.uploadJson({
      channel,
      jsonData,
      title: "주간 보고서 원천 데이터",
      initial_comment: "📊 주간 분석 보고서의 원천 데이터입니다.",
    });
  } catch (e: any) {
    console.error(e);
    await slack.postMessage({
      channel,
      text: `데이터 분석 보고서 작성에 실패했습니다. 잠시 후 다시 시도해주세요.\n에러: ${
        e?.message || e
      }`,
    });
  }

  return { status: "ok" };
}
