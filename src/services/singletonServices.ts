import { SlackService } from "./slackService";
import { OpenAIService } from "./openaiService";

// 싱글톤 인스턴스들을 저장할 변수
let slackServiceInstance: SlackService | null = null;
let openaiServiceInstance: OpenAIService | null = null;

// Slack 싱글톤 인스턴스 getter (lazy initialization)
export function getSlackService(): SlackService {
  if (!slackServiceInstance) {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      throw new Error("SLACK_BOT_TOKEN environment variable is required");
    }
    slackServiceInstance = new SlackService(botToken);
  }
  return slackServiceInstance;
}

// OpenAI 싱글톤 인스턴스 getter (lazy initialization)
export function getOpenAIService(): OpenAIService {
  if (!openaiServiceInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    const model = process.env.OPENAI_MODEL || "gpt-5-nano";
    openaiServiceInstance = new OpenAIService({ apiKey, model });
  }
  return openaiServiceInstance;
}

// 테스트나 재시작 시 인스턴스를 초기화하는 함수 (선택사항)
export function resetSingletonInstances(): void {
  slackServiceInstance = null;
  openaiServiceInstance = null;
}