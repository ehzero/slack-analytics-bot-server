import { Request, Response } from "express";
import { isValidSlackSignature } from "../services/slackVerifier";
import {
  getSlackService,
  getOpenAIService,
} from "../services/singletonServices";
import { executeSafeSelect } from "../services/dataService";
import { QA_SYSTEM_PROMPT } from "../constants/prompts";

// 로그 유틸: 조기 반환 사유를 구조화해 출력
function logReturnOk(reason: string, details?: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      level: "info",
      handler: "handleSlackEvents",
      action: "return_ok",
      reason,
      details: details || {},
    })
  );
}

function logWarn(reason: string, details?: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      level: "warn",
      handler: "handleSlackEvents",
      reason,
      details: details || {},
    })
  );
}

// Express용 Slack Events 핸들러
export async function handleSlackEvents(
  req: Request,
  _res: Response
): Promise<{ statusCode: number; body: any }> {
  // 헤더 키를 소문자로 정규화
  const normalizedHeaders = Object.fromEntries(
    Object.entries(req.headers || {}).map(([k, v]) => [
      k.toLowerCase(),
      String(v),
    ])
  );

  // 원문 바디 (서명 검증에 필요)
  const rawRequestBody = req.body ? req.body.toString("utf-8") : "";

  // Slack API - Event Subscriptions 관련 URL 검증 챌린지 처리 (봇 설치 시 발생)
  try {
    const parsed = rawRequestBody ? JSON.parse(rawRequestBody) : {};
    if (parsed?.type === "url_verification" && parsed?.challenge) {
      logReturnOk("url_verification_challenge", { hasChallenge: true });
      return { statusCode: 200, body: { challenge: parsed.challenge } };
    }
  } catch {
    // ignore
  }

  // Slack API - Event Subscriptions 에서 3초 안에 응답이 안 오면 재시도하는데 cold start인 경우 3초를 넘기기 때문에 무조건 재시도가 발생함.
  // Slack 재시도 이벤트는 ACK만 수행
  if (normalizedHeaders["x-slack-retry-num"]) {
    logReturnOk("retry_slack_event", {
      retryNum: normalizedHeaders["x-slack-retry-num"],
    });
    return { statusCode: 200, body: { ok: true } };
  }

  // 서명 검증 (개발 환경에서는 SKIP 가능)
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET || "";
  if (
    !isValidSlackSignature(
      normalizedHeaders,
      rawRequestBody,
      slackSigningSecret
    )
  ) {
    logWarn("invalid_signature", {
      hasSigningSecret: Boolean(slackSigningSecret),
      hasSignatureHeader: Boolean(normalizedHeaders["x-slack-signature"]),
      hasTimestampHeader: Boolean(
        normalizedHeaders["x-slack-request-timestamp"]
      ),
    });
    return { statusCode: 401, body: "unauthorized" };
  }

  // 파싱된 바디
  const parsedBody = rawRequestBody ? JSON.parse(rawRequestBody) : {};
  let processed = false;
  if (parsedBody?.type === "event_callback") {
    const slackEvent = parsedBody.event || {};
    const eventType = slackEvent.type; // 예: message, app_mention
    const subtype = slackEvent.subtype; // 예: bot_message
    const userId = slackEvent.user; // 발신 사용자 ID
    const sourceBotId = slackEvent.bot_id as string | undefined; // 봇 발신일 때 존재
    const channelId = slackEvent.channel; // 채널 ID
    const threadTs = slackEvent.thread_ts || slackEvent.ts; // 스레드 타임스탬프
    let messageText = (slackEvent.text || "").trim(); // 메시지 텍스트

    // 봇/자기 자신/시스템 메시지는 무시하여 루프 방지
    if (
      sourceBotId ||
      userId === process.env.SLACK_BOT_USER_ID ||
      subtype === "bot_message" ||
      !userId
    ) {
      logReturnOk("ignore_bot_self_or_system_message", {
        hasSourceBotId: Boolean(sourceBotId),
        isSelf: userId === process.env.SLACK_BOT_USER_ID,
        subtype,
        hasUserId: Boolean(userId),
      });
      return { statusCode: 200, body: { ok: true } };
    }

    // 멘션이 포함된 메시지 또는 app_mention 이벤트만 처리
    if (messageText) {
      const botUserId = process.env.SLACK_BOT_USER_ID;
      const mentionTag = botUserId ? `<@${botUserId}>` : undefined;

      const isMentionEvent = eventType === "app_mention";
      const isMessageWithMention =
        eventType === "message" && mentionTag
          ? messageText.includes(mentionTag)
          : false;

      // 멘션이 아닌 경우에는 처리하지 않음
      if (!(isMentionEvent || isMessageWithMention)) {
        logReturnOk("skip_non_mention_message", {
          eventType,
          isMentionEvent,
          isMessageWithMention,
        });
        return { statusCode: 200, body: { ok: true } };
      }

      if (mentionTag) {
        messageText = messageText.replaceAll(mentionTag, "").trim();
      }

      // 재시도여도 멱등 처리만 하고 동기 처리 진행
      const slack = getSlackService();
      const openai = getOpenAIService();

      try {
        const sqlFromLLM = await openai.answerQuestion({
          question: messageText,
          systemPrompt: QA_SYSTEM_PROMPT,
        });
        const { jsonData, executedSql } = await executeSafeSelect(sqlFromLLM);
        const sqlFence = String.fromCharCode(96).repeat(3);

        // 결과 요약 메시지 전송
        const summaryMessage = `SQL\n\n${sqlFence}${executedSql}\n${sqlFence}`;
        await slack.replyInThread({
          channel: channelId,
          thread_ts: threadTs,
          text: summaryMessage,
        });

        // JSON 파일 업로드
        if (jsonData) {
          await slack.uploadJson({
            channel: channelId,
            jsonData,
            title: `쿼리 결과`,
            initial_comment: `📊 쿼리 실행 결과를 JSON 파일로 첨부합니다.`,
            thread_ts: threadTs,
          });
        }

        processed = true;
      } catch (e: any) {
        console.error(e);
        await slack.replyInThread({
          channel: channelId,
          thread_ts: threadTs,
          text: `처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\\n에러: ${
            e?.message || e
          }`,
        });
        processed = true;
      }
    }
  }

  if (!processed) {
    logReturnOk("ack_only_no_processing", {
      hasEventCallback: parsedBody?.type === "event_callback",
    });
  }
  return { statusCode: 200, body: { ok: true } };
}
