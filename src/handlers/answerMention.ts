import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { isValidSlackSignature } from "../services/slackVerifier";
import { SlackService } from "../services/slackService";
import { OpenAIService } from "../services/openaiService";
import { executeSafeSelect } from "../services/dataService";
import stringWidth from "string-width";

// 표준 응답 헬퍼
function ok(
  body: unknown = { ok: true },
  statusCode = 200
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type":
        typeof body === "string" ? "text/plain" : "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

// 로그 유틸: 조기 반환 사유를 구조화해 출력 (CloudWatch에서 검색 용이)
function logReturnOk(reason: string, details?: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      level: "info",
      handler: "handleSlackMentionQnA",
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
      handler: "handleSlackMentionQnA",
      reason,
      details: details || {},
    })
  );
}

function truncateForSlack(text: string, max = 10000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n... (truncated)";
}

function formatRowsAsTable(rows: any[], maxRows = 50): string {
  const fence = String.fromCharCode(96).repeat(3);
  if (!rows || rows.length === 0) {
    return `${fence}\n(0 rows)\n${fence}`;
  }
  const limited = rows.slice(0, maxRows);
  // 모든 컬럼 키 수집
  const columns = Array.from(
    new Set(limited.flatMap((row) => Object.keys(row || {})))
  );
  // 문자열 변환 및 폭 계산
  const normalize = (v: unknown) => String(v ?? "").replace(/\r?\n/g, " ");
  const stringRows = limited.map((row) =>
    columns.map((col) => normalize((row as Record<string, unknown>)[col]))
  );
  const header = columns;
  const all = [header, ...stringRows];

  // 숫자열 판별: 해당 컬럼의 모든 non-empty 값이 숫자 형태면 숫자열로 간주
  const isNumericColumn = columns.map((_, idx) =>
    all.slice(1).every((r) => {
      const v = r[idx]?.trim();
      if (!v) return true; // 빈 값은 무시
      return /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(v);
    })
  );

  const colWidths = columns.map((_, idx) =>
    Math.max(...all.map((r) => stringWidth(r[idx] ?? "")))
  );

  const padLeft = (text: string, width: number) => {
    const diff = width - stringWidth(text);
    return diff > 0 ? " ".repeat(diff) + text : text;
  };
  const padRight = (text: string, width: number) => {
    const diff = width - stringWidth(text);
    return diff > 0 ? text + " ".repeat(diff) : text;
  };

  const sep = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const line = (cells: string[]) =>
    "| " +
    cells
      .map((c, i) =>
        isNumericColumn[i]
          ? padLeft(c, colWidths[i])
          : padRight(c, colWidths[i])
      )
      .join(" | ") +
    " |";

  const headerLine =
    "| " + header.map((c, i) => padRight(c, colWidths[i])).join(" | ") + " |";
  const bodyLines = stringRows.map((r) => line(r));
  const table = [sep, headerLine, sep, ...bodyLines, sep].join("\n");
  return `${fence}\n${table}\n${fence}`;
}

// 멘션 기반 Q&A 처리 핸들러
export async function handleSlackMentionQnA(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  // 헤더 키를 소문자로 정규화
  const normalizedHeaders = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  // 원문 바디 (서명 검증에 필요)
  const rawRequestBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf-8")
    : event.body || "";

  // Slack API - Event Subscriptions 관련 URL 검증 챌린지 처리 (봇 설치 시 발생)
  try {
    const parsed = rawRequestBody ? JSON.parse(rawRequestBody) : {};
    if (parsed?.type === "url_verification" && parsed?.challenge) {
      logReturnOk("url_verification_challenge", { hasChallenge: true });
      return ok({ challenge: parsed.challenge });
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
    return ok();
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
    return ok("unauthorized", 401);
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
      return ok();
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
        return ok();
      }

      if (mentionTag) {
        messageText = messageText.replaceAll(mentionTag, "").trim();
      }

      // 재시도여도 멱등 처리만 하고 동기 처리 진행
      const slack = new SlackService(process.env.SLACK_BOT_TOKEN || "");
      const openai = new OpenAIService({
        apiKey: process.env.OPENAI_API_KEY || "",
        model: process.env.OPENAI_MODEL || "gpt-5-nano",
      });

      try {
        const sqlFromLLM = await openai.answerQuestionFromJson({
          question: messageText,
          systemPrompt: process.env.OPENAI_QA_SYSTEM_PROMPT || "",
        });
        const { rows, executedSql } = await executeSafeSelect(sqlFromLLM);
        const header = `총 ${rows.length}행`;
        const sqlFence = String.fromCharCode(96).repeat(3);
        const tableBlock = formatRowsAsTable(rows, 100);
        const headMessage = truncateForSlack(
          `SQL 실행 결과\n\n${sqlFence}${executedSql}\n${sqlFence}\n${header}`
        );
        await slack.replyInThread({
          channel: channelId,
          thread_ts: threadTs,
          text: headMessage || "결과가 없습니다.",
        });

        const tableMessage = truncateForSlack(tableBlock);
        await slack.replyInThread({
          channel: channelId,
          thread_ts: threadTs,
          text: tableMessage,
        });
        processed = true;
      } catch (e: any) {
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
  return ok();
}
