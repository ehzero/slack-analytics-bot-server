import OpenAI from "openai";

export class OpenAIService {
  // OpenAI SDK 클라이언트
  private client: OpenAI;
  // 사용 모델명 (예: gpt-5-nano)
  private model: string;

  constructor(params: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: params.apiKey });
    this.model = params.model ?? "gpt-5-nano";
  }

  async answerQuestion(params: {
    question: string; // 사용자의 질문
    systemPrompt: string; // 시스템 지시 프롬프트
    maxTokens?: number; // 응답 토큰 제한
  }): Promise<string> {
    const { question, systemPrompt, maxTokens } = params;
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `질문: ${question}`,
      },
    ];

    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: maxTokens,
    });
    return (resp.choices?.[0]?.message?.content ?? "").trim();
  }

  async summarizeJsonReport(params: {
    jsonData: unknown; // 보고서용 도메인 JSON 데이터
    systemPrompt: string; // 요약 지시 프롬프트
    maxTokens?: number; // 응답 토큰 제한
  }): Promise<string> {
    const { jsonData, systemPrompt, maxTokens } = params;
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `JSON:\n${JSON.stringify(jsonData)}`,
      },
    ];

    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: maxTokens,
    });

    return resp.choices?.[0]?.message?.content ?? "";
  }
}
