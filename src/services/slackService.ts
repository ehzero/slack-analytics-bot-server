import { WebClient } from "@slack/web-api";

export class SlackService {
  private client: WebClient;

  constructor(botToken: string) {
    this.client = new WebClient(botToken);
  }

  // 채널에 새 메시지 전송
  async postMessage(params: { channel: string; text: string }): Promise<void> {
    await this.client.chat.postMessage({
      channel: params.channel,
      text: params.text,
    });
  }

  // 스레드에 답글 전송
  async replyInThread(params: {
    channel: string;
    thread_ts?: string; // 명확성을 위해 선택적 허용 (스레드가 없으면 새 스레드 시작)
    text: string;
  }): Promise<void> {
    await this.client.chat.postMessage({
      channel: params.channel,
      text: params.text,
      thread_ts: params.thread_ts,
    });
  }
}
