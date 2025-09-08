## Slack Analytics Bot (AWS SAM, TypeScript) 🚀

Slack에서 멘션 기반 질의응답(SQL 실행)과 주간 데이터 분석 보고서를 제공하는 서버리스 봇입니다. AWS SAM + Lambda(Node.js 20, TypeScript, esbuild)로 배포합니다.

### ✨ 주요 기능

- 💬 멘션 Q&A: 채널에서 봇을 멘션하면 자연어 질문을 SQL로 변환(OpenAI) → MySQL 조회 → 결과를 텍스트 테이블 코드블럭으로 응답(2개 메시지: SQL/헤더, 테이블)
- 📊 주간 보고서: MySQL에서 집계 JSON을 조회해 OpenAI로 요약 텍스트 생성 → 지정 채널에 게시
- 🔒 보안/안전: Slack 서명 검증, SQL SELECT-only 강제, LIMIT 자동 부여, 다중문/위험 키워드 차단

## 🏗️ 아키텍처 개요

- 🧩 Lambda Functions
  - `handlers/answerMention.handleSlackMentionQnA`: Slack Events API 수신 및 멘션 Q&A 처리 (API Gateway `POST /slack/events`)
  - `handlers/generateReport.generateAnalyticsReport`: EventBridge 스케줄로 주간 보고서 생성/전송
- 💬 Slack API: `chat.postMessage` 사용
- 🤖 OpenAI API: 질의 SQL 생성/보고서 요약 생성
- 🗄️ MySQL: `mysql2/promise` 풀 기반 쿼리 (`createPool`) + 안전 가드

## 📁 리포지토리 구조

```
scripts
  escape_newlines.js        # 프롬프트 한 줄 문자열로 변환용 스크립트
src/
  handlers/
    answerMention.ts        # Slack Events 핸들러 (멘션 Q&A)
    generateReport.ts       # 주간 보고서 생성/전송 핸들러
  services/
    dataService.ts          # DB 풀, 안전 SELECT 실행, 주간 JSON 조회, SQL 가드
    openaiService.ts        # OpenAI 래퍼
    slackService.ts         # Slack Web API 래퍼
    slackVerifier.ts        # Slack 서명 검증(HMAC)
    sql.ts                  # 주간 보고서용 SQL(대형 JSON 집계)
template.yaml               # SAM 템플릿 (리소스/파라미터/빌드 설정)
tsconfig.json               # TypeScript 컴파일 옵션
package.json                # 의존성/스크립트
sam-env.json.example        # 로컬 개발(SAM)용 환경변수 예시
```

## ⚙️ 런타임/의존성

- Node.js 20 (Lambda), TypeScript 5
- 핵심 패키지: `@slack/web-api`, `openai`, `mysql2`, `string-width`
  - `string-width`: 한글 표시 폭을 고려한 텍스트 테이블 정렬

## 🔧 환경 변수

`template.yaml`의 Parameters 및 Globals.Environment 참고. 로컬은 `sam --env-vars`로 주입하세요.

- `SLACK_BOT_TOKEN`: Bot User OAuth Token (`xoxb-...`)
- `SLACK_SIGNING_SECRET`: Slack Signing Secret
- `REPORT_CHANNEL_ID`: 보고서 게시 채널 ID
- `OPENAI_API_KEY`: OpenAI API Key
- `OPENAI_MODEL`: 기본 `gpt-5-nano`
- `OPENAI_QA_SYSTEM_PROMPT`: Q&A용 시스템 프롬프트(LLM이 SQL만 반환하도록 강제)
- `OPENAI_REPORT_SYSTEM_PROMPT`: 보고서 요약 프롬프트
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: MySQL 연결 정보
- `LOG_LEVEL`: 기본 `INFO`
- `ScheduleExpression`: 기본 `cron(0 23 ? * SUN *)` (KST 월 08:00)이며 필요 시 변경

민감정보는 VCS에 커밋하지 말고, 로컬에만 보관하거나 SSM/Secrets Manager 사용 권장.

## 🛠️ 로컬 개발 (SAM)

1. 빌드

```bash
sam build
```

2. 로컬 API 실행 (Slack Events 테스트)

```bash
sam local start-api --env-vars sam-env.json
```

- 엔드포인트: `http://127.0.0.1:3000/slack/events`
- Slack Event Subscriptions는 퍼블릭 URL이 필요하므로 `ngrok http 3000`으로 터널링 후 Request URL에 설정하세요.

3. Slack 앱 설정

- OAuth & Permissions: `chat:write` 스코프 부여, 앱 워크스페이스 설치
- Event Subscriptions: Enable On, Request URL에 `https://<ngrok-id>.ngrok.io/slack/events`
  - Subscribe to bot events: `app_mention` (필요 시 추가)
- Basic Information: Signing Secret 확인 후 환경 변수에 설정

4. GenerateReport 단발 실행(로컬)

```bash
# macOS zsh 예시
sam local invoke GenerateReportFunction --env-vars sam-env.json --event <(echo '{}')
# 또는 파일로
echo '{}' > /tmp/empty.json
sam local invoke GenerateReportFunction --env-vars sam-env.json --event /tmp/empty.json
```

## 🔬 동작 상세

### 💬 멘션 Q&A 플로우 (`answerMention.ts`)

1. Slack 서명 검증(HMAC, 5분 윈도우) 통과 실패 시 401
2. `app_mention` 또는 멘션 포함 메시지(`message`)만 처리, 봇/시스템 메시지 무시
3. OpenAI에 자연어 질문 → SQL 텍스트만 생성
4. `dataService.executeSafeSelect`로 실행
   - `isSafeSelectQuery`: SELECT-only, 위험 키워드/다중문 차단
   - `ensureLimit`: LIMIT 없으면 기본 50 부여
   - MySQL 풀(`createPool`)을 통해 `query` 실행
5. 응답 메시지 2개 전송(스레드):
   - 1. 실행 SQL 코드블럭 + 총 행 수 헤더
   - 2. 결과 텍스트 테이블 코드블럭
6. 테이블 렌더링: `string-width`로 표시 폭 기준 정렬, 숫자 컬럼은 우측 정렬, 문자열은 좌측 정렬

### 📈 주간 보고서 (`generateReport.ts`)

- `services/sql.ts`의 대형 집계 SQL로 JSON 생성 → OpenAI 요약 → `REPORT_CHANNEL_ID`로 게시

## 🚀 배포 (SAM)

처음 1회:

```bash
sam build
sam deploy --guided
```

Guided 입력 시 "🔧 환경 변수" 섹션에 기재된 값들을 파라미터로 입력하세요.
배포 후 출력된 API Gateway `/slack/events`를 Slack Request URL에 설정하세요.

## 🧯 운영/트러블슈팅

- Slack 3초 응답 제한: Lambda cold start나 DB/LLM 지연으로 3초 초과 시 Slack이 재시도합니다. 코드에서 `x-slack-retry-num` 재시도는 ACK만 수행합니다. 필요 시 SQS/비동기 패턴 도입 고려.
- DB 연결: 풀은 핸들러 스코프 밖에서 생성되어 재사용됩니다. RDS Proxy 사용 시 cold start/스파이크에 더 안정적.
- SQL 안전성: SELECT-only 가드와 LIMIT 강제 부여가 적용됩니다. 위반 시 에러로 응답.
- 테이블 정렬: `string-width`를 사용해 한글 폭을 고려합니다. 숫자/문자 혼합 컬럼 판별이 애매하면 컬럼별 서식 지정 로직 확장 고려.
- 권한 오류: Slack `chat:write` 스코프와 채널 권한 확인. 채널 ID 오타 시 `channel_not_found`.

## 📄 라이선스

사내/개인 프로젝트 기준에 따라 적용하세요.
