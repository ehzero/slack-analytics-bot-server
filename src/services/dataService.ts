import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { WEEKLY_ANALYTICS_SQL } from "../constants/sql";

const connection = mysql.createPool({
  host: process.env.DB_HOST || "",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "",
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  multipleStatements: false,
});

// SQL 안전성 검증 (SELECT-only, 위험 키워드 차단, 다중문 금지)
export function isSafeSelectQuery(sql: string): boolean {
  const trimmed = sql.trim();
  const withoutTrailingSemis = trimmed.replace(/;+\s*$/, "");

  // 1. SELECT 또는 CTE(With)로 시작해야 함
  if (!/^(SELECT|WITH)\s/i.test(withoutTrailingSemis)) return false;

  // 2. 위험 키워드 금지
  const forbiddenKeywords =
    /(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|ATTACH|DETACH|MERGE)\b/i;
  if (forbiddenKeywords.test(withoutTrailingSemis)) return false;

  // 3. INTO OUTFILE / DUMPFILE 금지
  if (/(INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i.test(withoutTrailingSemis))
    return false;

  // 4. 중간 세미콜론 금지 (다중문 방지)
  // 마지막 세미콜론만 제거했기 때문에, 내부에 존재하면 false
  const withoutAllSemis = withoutTrailingSemis.replace(/;+/g, "");
  if (withoutAllSemis.includes(";")) return false;

  return true;
}

// LIMIT 강제 부여 (없으면 기본 100행)
export function ensureLimit(sql: string, defaultLimit = 100): string {
  const hasLimit = /\blimit\s+\d+\b/i.test(sql);
  if (hasLimit) return sql;
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  return `${trimmed} LIMIT ${defaultLimit}`;
}

// 안전한 SELECT 쿼리 실행 유틸
export async function executeSafeSelect(rawSql: string, defaultLimit = 100) {
  console.log(rawSql);
  if (!isSafeSelectQuery(rawSql)) {
    throw new Error("Unsafe SQL: Only single SELECT queries are allowed.");
  }

  const sqlToRun = ensureLimit(rawSql, defaultLimit);
  const [rows] = await connection.query<RowDataPacket[]>(sqlToRun);
  return { rows, executedSql: sqlToRun };
}

// 분석용 데이터 조회
export async function fetchSummaryJsonFromDb() {
  const [rows] = await connection.query<any[]>(WEEKLY_ANALYTICS_SQL);
  const value = rows?.[0]?.final_json;
  if (typeof value === "string") return JSON.parse(value);
  if (value && typeof value === "object") return value;
  throw new Error("Empty result from SQL");
}
