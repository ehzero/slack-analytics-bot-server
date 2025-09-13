import { WebClient } from "@slack/web-api";
import * as fs from "fs";
import * as path from "path";

export class SlackService {
  private client: WebClient;

  constructor(botToken: string) {
    this.client = new WebClient(botToken);
  }

  // 채널에 새 메시지 전송
  async postMessage(params: {
    channel: string;
    text: string;
    blocks?: any[];
  }): Promise<void> {
    await this.client.chat.postMessage({
      channel: params.channel,
      text: params.text,
      blocks: params.blocks,
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

  // JSON 데이터를 파일로 업로드
  async uploadJson(params: {
    channel: string;
    jsonData: any;
    title?: string;
    initial_comment?: string;
    thread_ts?: string;
  }): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `data-${timestamp}.json`;
    const tempFilePath = path.join(process.cwd(), "temp", filename);

    // temp 디렉토리가 없으면 생성
    const tempDir = path.dirname(tempFilePath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // JSON 파일로 저장
    fs.writeFileSync(
      tempFilePath,
      JSON.stringify(params.jsonData, null, 2),
      "utf-8"
    );

    // Slack에 파일 업로드
    const uploadParams: any = {
      channel_id: params.channel,
      file: fs.createReadStream(tempFilePath),
      filename,
      title: params.title || filename,
      initial_comment: params.initial_comment,
    };
    
    if (params.thread_ts) {
      uploadParams.thread_ts = params.thread_ts;
    }
    
    await this.client.files.uploadV2(uploadParams);
  }
}
