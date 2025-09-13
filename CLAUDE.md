# CLAUDE.md

이 파일은 Claude Code (claude.ai/code)가 이 저장소에서 작업할 때 참고하는 가이드입니다.

## 프로젝트 개요

Express.js, TypeScript, Node.js 20으로 구축된 Slack 분석 봇으로, EC2에서 실행되도록 설계되었습니다. 두 가지 주요 기능을 제공합니다:

1. **멘션 Q&A**: 자연어 질문을 OpenAI를 통해 SQL 쿼리로 변환하고, MySQL에서 안전하게 실행하여 포맷된 결과를 반환
2. **주간 보고서**: 집계된 데이터로부터 자동화된 분석 보고서를 생성하여 Slack 채널에 게시

## 개발 명령어

### 로컬 개발

```bash
# 의존성 설치
npm install

# TypeScript 빌드
npm run build

# 자동 재시작을 지원하는 개발 서버 실행
npm run dev

# 프로덕션 서버 실행
npm start
```

### EC2 배포

```bash
# 애플리케이션 빌드
npm run build

# PM2로 실행 (프로덕션 권장)
pm2 start dist/server.js --name slack-analytics-bot

# 직접 실행
npm start
```

### 환경 설정

- `.env.example`을 `.env`로 복사하고 필요한 모든 변수 설정
- EC2 인스턴스에서 MySQL 데이터베이스에 접근 가능한지 확인
- Slack 앱 웹훅 URL을 `http://your-ec2-ip:3000/slack/events`로 설정

## 아키텍처

### 핵심 컴포넌트

**Express 서버:**

- `src/server.ts`: 헬스체크와 Slack 이벤트 엔드포인트를 포함한 메인 Express.js 애플리케이션
- `src/scheduler.ts`: 주간 보고서 생성을 위한 크론 기반 스케줄러

**요청 핸들러:**

- `handlers/slackEventsHandler.ts`: Express를 통한 Slack 멘션 이벤트 처리 (`POST /slack/events`)
- `handlers/generateReport.ts`: 주간 보고서 생성을 위한 크론 작업 함수

**서비스 레이어:**

- `services/dataService.ts`: MySQL 연결 풀, 안전한 SELECT 실행, 쿼리 검증
- `services/slackService.ts`: `@slack/web-api`를 사용하는 Slack Web API 래퍼
- `services/openaiService.ts`: SQL 생성과 보고서 요약을 위한 OpenAI API 통합
- `services/slackVerifier.ts`: Slack 요청 인증을 위한 HMAC 서명 검증

**데이터 및 상수:**

- `constants/sql.ts`: 주간 보고서용 대형 집계 SQL 쿼리 포함
- `constants/prompts.ts`: Q&A와 보고서 생성을 위한 OpenAI 시스템 프롬프트

### 주요 아키텍처 패턴

1. **데이터베이스 안전성**: 모든 사용자 생성 SQL은 `isSafeSelectQuery()` 검증을 거침 (SELECT만 허용, 금지 키워드, 다중 문장 방지) 및 자동 LIMIT 주입
2. **연결 풀링**: MySQL 풀(`mysql2/promise.createPool`)은 핸들러 범위 밖에서 생성되어 서버 생명주기 동안 재사용
3. **Slack 통합**: 적절한 서명 검증과 함께 공식 `@slack/web-api` 클라이언트 사용
4. **Express 배포**: EC2 배포에 적합한 크론 스케줄링을 포함한 표준 Node.js 서버

### 응답 플로우 (멘션 Q&A)

1. Express가 `/slack/events`에서 POST 요청 수신
2. Slack 서명 검증 (5분 윈도우를 가진 HMAC)
3. 이벤트 필터링 (`app_mention` 또는 멘션을 포함한 메시지만)
4. OpenAI가 자연어 쿼리로부터 SQL 생성
5. `executeSafeSelect()`가 안전성 검사와 함께 쿼리 검증 및 실행
6. 한국어 텍스트 정렬을 위해 `string-width`를 사용한 텍스트 테이블 포맷팅
7. 두 개의 스레드 Slack 메시지: SQL 코드 블록 + 결과 테이블

### 스케줄링 (주간 보고서)

1. `node-cron` 스케줄러가 `SCHEDULE_EXPRESSION`에 따라 실행 (기본값: 일요일 23:00 UTC)
2. `generateAnalyticsReport()`가 MySQL에서 집계 데이터 조회
3. OpenAI가 데이터를 Slack 형식 블록으로 요약
4. 설정된 `REPORT_CHANNEL_ID`에 보고서 게시

### 데이터베이스 스키마 컨텍스트

애플리케이션이 작업하는 주요 테이블들:

- `user_action(user_action_idx, user_action_type, ceo_idx, extra_data, ins_date)`
- `ceo(ceo_idx, corp_idx)`
- `tbl_corp(corp_idx, corp_name)`

주요 이벤트 타입: `print_pop`, `save_pamphlet`, `send_message`, `visit`, `save_pop`

## 환경 설정

필수 환경 변수들 (`.env` 파일에서 설정):

**Slack:**

- `SLACK_BOT_TOKEN`: 봇 사용자 OAuth 토큰 (xoxb-\*)
- `SLACK_SIGNING_SECRET`: 요청 검증을 위한 앱 서명 비밀키
- `REPORT_CHANNEL_ID`: 주간 보고서를 위한 대상 채널

**OpenAI:**

- `OPENAI_API_KEY`: API 키
- `OPENAI_MODEL`: 모델 이름 (기본값: gpt-5-nano)

**데이터베이스:**

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: MySQL 연결 세부사항

**스케줄링:**

- `SCHEDULE_EXPRESSION`: 주간 보고서를 위한 크론 표현식 (기본값: "0 23 \* \* 0")
- `RUN_REPORT_ON_START`: 서버 시작 시 즉시 보고서 실행 (개발 기능)

## 개발 노트

### 코드 스타일 및 규약

- 엄격한 컴파일 설정을 가진 TypeScript
- CommonJS 모듈 (ESM 아님)
- JSON 형식의 구조화된 로깅
- 적절한 HTTP 상태 코드를 가진 에러 처리
- 전체적인 한국어 지원 (코멘트, 프롬프트, 응답)

### 보안 고려사항

- 쿼리 검증과 매개변수화를 통한 SQL 인젝션 방지
- Slack 요청 서명 검증 (HMAC-SHA256)
- 자동 LIMIT 강제를 가진 SELECT 전용 데이터베이스 작업
- `.env` 파일에 저장되는 환경 변수 (git에서 제외)

### 성능 및 확장성

- 데이터베이스 효율성을 위한 연결 풀링
- 적절한 에러 처리를 가진 Express.js 서버
- `/health`에서 헬스체크 엔드포인트
- 우아한 종료 처리 (SIGTERM, SIGINT)

### 로컬 테스트 설정

1. `.env.example`을 `.env`로 복사하고 필요한 모든 변수 설정
2. 자동 재시작 개발을 위해 `npm run dev` 실행
3. Slack 웹훅 테스트를 위해 ngrok 사용: `ngrok http 3000`
4. ngrok URL + `/slack/events`로 Slack 앱 Event Subscriptions 설정
5. 봇이 `chat:write` 스코프를 가지고 대상 채널에 추가되었는지 확인

### EC2에서 프로덕션 배포

1. Node.js 20+ 및 PM2를 글로벌로 설치
2. 저장소를 클론하고 `npm install` 실행
3. 프로덕션 값으로 `.env` 설정
4. `npm run build`로 빌드
5. `pm2 start dist/server.js --name slack-analytics-bot`으로 시작
6. 포트 3000을 허용하도록 보안 그룹 설정 (또는 역방향 프록시 사용)
7. 프로덕션용 HTTPS를 위한 SSL 인증서 설정 (권장)
