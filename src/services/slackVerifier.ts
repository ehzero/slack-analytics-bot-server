import crypto from "crypto";

export function isValidSlackSignature(
  headers: Record<string, string | undefined>, // 소문자 정규화된 헤더
  body: string, // 원문 바디
  signingSecret: string // Slack Signing Secret
): boolean {
  // 필수 값 확인
  if (!signingSecret) return false;

  // 서명/타임스탬프 추출
  const ts = headers["x-slack-request-timestamp"];
  const sig = headers["x-slack-signature"];
  if (!ts || !sig) return false;

  // 리플레이 공격 방지: 5분 이내 요청만 허용
  const now = Math.floor(Date.now() / 1000);
  const reqTs = Number(ts);
  if (!Number.isFinite(reqTs) || Math.abs(now - reqTs) > 60 * 5) return false;

  // 서명 생성 및 비교 (타이밍 안전 비교)
  const base = `v0:${ts}:${body}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  const computed = `v0=${hmac}`;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
}
