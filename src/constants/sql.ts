export const WEEKLY_ANALYTICS_SQL = `WITH
-- fixed sequences (재귀 대신 명시적 시퀀스)
weeks AS (
  SELECT 1 AS offset UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
),
months AS (
  SELECT 1 AS offset UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
),

-- parameters: 정확한 기간 시작/끝을 한 번만 계산
params AS (
  SELECT
    CURDATE() AS today,

    /* last week (지난 주 전체) */
    DATE_SUB(CURDATE(), INTERVAL 1 WEEK) AS last_week_base,
    DATE_SUB(DATE_SUB(CURDATE(), INTERVAL 1 WEEK), INTERVAL WEEKDAY(DATE_SUB(CURDATE(), INTERVAL 1 WEEK)) DAY) AS last_week_start,
    DATE_ADD(
      DATE_SUB(DATE_SUB(CURDATE(), INTERVAL 1 WEEK), INTERVAL WEEKDAY(DATE_SUB(CURDATE(), INTERVAL 1 WEEK)) DAY),
      INTERVAL 6 DAY
    ) AS last_week_end,

    /* first week we want to include = 5주 전의 해당 주의 시작(월요일) */
    DATE_SUB(CURDATE(), INTERVAL 5 WEEK) AS first_week_base,
    DATE_SUB(DATE_SUB(CURDATE(), INTERVAL 5 WEEK), INTERVAL WEEKDAY(DATE_SUB(CURDATE(), INTERVAL 5 WEEK)) DAY) AS first_week_start,

    /* last month (지난 달 전체) */
    DATE_SUB(CURDATE(), INTERVAL 1 MONTH) AS last_month_base,
    LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AS last_month_end,

    /* first month we want to include = 6개월 전의 월 시작일 */
    DATE_SUB(CURDATE(), INTERVAL 6 MONTH) AS first_month_base,
    DATE_SUB(DATE_SUB(CURDATE(), INTERVAL 6 MONTH), INTERVAL DAY(DATE_SUB(CURDATE(), INTERVAL 6 MONTH))-1 DAY) AS first_month_start
),

-- week_list / month_list: 표시용 라벨 및 기간 (이번 주/이번 달 제외)
week_list AS (
  SELECT
    YEAR(DATE_SUB(p.today, INTERVAL w.offset WEEK)) AS year_num,
    WEEK(DATE_SUB(p.today, INTERVAL w.offset WEEK),1) AS week_num,
    DATE_FORMAT(
      DATE_SUB(DATE_SUB(p.today, INTERVAL w.offset WEEK), INTERVAL WEEKDAY(DATE_SUB(p.today, INTERVAL w.offset WEEK)) DAY),
      '%m-%d'
    ) AS week_start,
    DATE_FORMAT(
      DATE_ADD(
        DATE_SUB(DATE_SUB(p.today, INTERVAL w.offset WEEK), INTERVAL WEEKDAY(DATE_SUB(p.today, INTERVAL w.offset WEEK)) DAY),
        INTERVAL 6 DAY
      ),
      '%m-%d'
    ) AS week_end
  FROM weeks w
  CROSS JOIN params p
),

month_list AS (
  SELECT
    DATE_FORMAT(DATE_SUB(p.today, INTERVAL m.offset MONTH), '%Y년 %m월') AS month_label,
    DATE_FORMAT(
      DATE_SUB(DATE_SUB(p.today, INTERVAL m.offset MONTH), INTERVAL DAY(DATE_SUB(p.today, INTERVAL m.offset MONTH))-1 DAY),
      '%m-%d'
    ) AS month_start,
    DATE_FORMAT(LAST_DAY(DATE_SUB(p.today, INTERVAL m.offset MONTH)), '%m-%d') AS month_end
  FROM months m
  CROSS JOIN params p
),

-- 요일 매핑 테이블 (가독성용)
weekday_map AS (
  SELECT 1 AS weekday_number, '일요일' AS weekday_name UNION ALL
  SELECT 2, '월요일' UNION ALL
  SELECT 3, '화요일' UNION ALL
  SELECT 4, '수요일' UNION ALL
  SELECT 5, '목요일' UNION ALL
  SELECT 6, '금요일' UNION ALL
  SELECT 7, '토요일'
)

SELECT JSON_OBJECT(
  -- 1. 주간 로그 통계 (최근 5주, 이번주 제외)
  '주간_로그_통계_(최근_5주)', (
    SELECT JSON_ARRAYAGG(js)
    FROM (
      SELECT JSON_OBJECT(
        '주', CONCAT(w.year_num,'년 ', w.week_num,'주차 (', w.week_start,'~', w.week_end,')'),
        'save_pamphlet', IFNULL(t.save_pamphlet_count,0),
        'send_message', IFNULL(t.send_message_count,0),
        'print_pop', IFNULL(t.print_pop_count,0)
      ) AS js
      FROM week_list w
      LEFT JOIN (
        SELECT
          YEAR(ua.ins_date) AS year_num,
          WEEK(ua.ins_date,1) AS week_num,
          SUM(CASE WHEN ua.user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
          SUM(CASE WHEN ua.user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
          SUM(CASE WHEN ua.user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
        FROM martjangbogo.user_action ua
        CROSS JOIN params p
        WHERE ua.ins_date BETWEEN p.first_week_start AND p.last_week_end
          AND ua.user_action_type IN ('save_pamphlet','send_message','print_pop')
        GROUP BY YEAR(ua.ins_date), WEEK(ua.ins_date,1)
      ) t ON w.year_num = t.year_num AND w.week_num = t.week_num
      ORDER BY w.year_num DESC, w.week_num DESC
    ) sq
  ),

  -- 2. 월간 로그 통계 (최근 6개월, 이번달 제외)
  '월간_로그_통계_(최근_6개월)', (
    SELECT JSON_ARRAYAGG(js)
    FROM (
      SELECT JSON_OBJECT(
        '월', CONCAT(m.month_label,' (', m.month_start,'~', m.month_end,')'),
        'save_pamphlet', IFNULL(t.save_pamphlet_count,0),
        'send_message', IFNULL(t.send_message_count,0),
        'print_pop', IFNULL(t.print_pop_count,0)
      ) AS js
      FROM month_list m
      LEFT JOIN (
        SELECT
          DATE_FORMAT(ua.ins_date,'%Y년 %m월') AS month_label,
          SUM(CASE WHEN ua.user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
          SUM(CASE WHEN ua.user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
          SUM(CASE WHEN ua.user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
        FROM martjangbogo.user_action ua
        CROSS JOIN params p
        WHERE ua.ins_date BETWEEN p.first_month_start AND p.last_month_end
          AND ua.user_action_type IN ('save_pamphlet','send_message','print_pop')
        GROUP BY month_label
      ) t ON m.month_label = t.month_label
      ORDER BY m.month_label DESC
    ) sq
  ),

  -- 3. 요일별 로그 통계 (최근 30일, 모든 요일을 항상 표시)
  '요일별_로그_통계_(최근_30일)', (
    SELECT JSON_ARRAYAGG(js)
    FROM (
      SELECT JSON_OBJECT(
        'weekday', wm.weekday_name,
        'save_pamphlet', IFNULL(a.save_pamphlet_count,0),
        'send_message', IFNULL(a.send_message_count,0),
        'print_pop', IFNULL(a.print_pop_count,0)
      ) AS js
      FROM weekday_map wm
      LEFT JOIN (
        SELECT
          DAYOFWEEK(ua.ins_date) AS weekday_number,
          SUM(CASE WHEN ua.user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
          SUM(CASE WHEN ua.user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
          SUM(CASE WHEN ua.user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
        FROM martjangbogo.user_action ua
        CROSS JOIN params p
        WHERE ua.ins_date >= DATE_SUB(p.today, INTERVAL 30 DAY)
          AND ua.user_action_type IN ('save_pamphlet','send_message','print_pop')
        GROUP BY DAYOFWEEK(ua.ins_date)
      ) a ON wm.weekday_number = a.weekday_number
      ORDER BY FIELD(wm.weekday_number,2,3,4,5,6,7,1)
    ) sq
  ),

  -- 4. 마트별 로그 통계 (최근 30일)
  '마트별_로그_통계_(최근_30일)', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'corp_name', corp_name,
      'save_pamphlet', save_pamphlet_count,
      'send_message', send_message_count,
      'print_pop', print_pop_count,
      'total', total
    ))
    FROM (
      SELECT
        corp.corp_name,
        SUM(CASE WHEN ua.user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
        SUM(CASE WHEN ua.user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
        SUM(CASE WHEN ua.user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count,
        SUM(CASE WHEN ua.user_action_type IN ('save_pamphlet','send_message','print_pop') THEN 1 ELSE 0 END) AS total
      FROM martjangbogo.user_action ua
      JOIN martjangbogo.ceo c ON c.ceo_idx = ua.ceo_idx
      JOIN martjangbogo.tbl_corp corp ON corp.corp_idx = c.corp_idx
      CROSS JOIN params p
      WHERE ua.ins_date >= DATE_SUB(p.today, INTERVAL 30 DAY)
        AND ua.user_action_type IN ('save_pamphlet','send_message','print_pop')
      GROUP BY corp.corp_idx, corp.corp_name
      ORDER BY total DESC
    ) t
  ),

  -- 5. 현재 활성 마트 (부에노 관련 마트 제외)
  '현재_활성_마트_(최근_30일)', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'corp_idx', c.corp_idx,
      'corp_name', t.corp_name,
      'approval_date', DATE_FORMAT(c.approval_date,'%Y-%m-%d')
    ))
    FROM martjangbogo.ceo c
    LEFT JOIN martjangbogo.tbl_corp t ON c.corp_idx = t.corp_idx
    WHERE c.approval_date IS NOT NULL
      AND c.exp_date >= CURDATE()
      AND c.corp_idx NOT IN (104133,96073,103959,72500)
  ),

  -- 6. 주간 신규/만료 마트 (최근 5주) — 신규/만료를 분리해서 UNION 후 합산
  '주간_신규_만료_마트_(최근_30일)', (
    SELECT JSON_ARRAYAGG(js)
    FROM (
      SELECT JSON_OBJECT(
        '주', CONCAT(w.year_num,'년 ', w.week_num,'주차 (', w.week_start,'~', w.week_end,')'),
        '신규_마트', IFNULL(t.new_count,0),
        '만료_마트', IFNULL(t.expired_count,0)
      ) AS js
      FROM week_list w
      LEFT JOIN (
        SELECT
          se.year_num,
          se.week_num,
          SUM(se.new_count) AS new_count,
          SUM(se.expired_count) AS expired_count
        FROM (
          SELECT YEAR(approval_date) AS year_num, WEEK(approval_date,1) AS week_num, COUNT(DISTINCT corp_idx) AS new_count, 0 AS expired_count
          FROM martjangbogo.ceo c
          CROSS JOIN params p
          WHERE c.approval_date BETWEEN p.first_week_start AND p.last_week_end
            AND c.corp_idx NOT IN (104133,96073,103959,72500)
          GROUP BY YEAR(approval_date), WEEK(approval_date,1)

          UNION ALL

          SELECT YEAR(exp_date) AS year_num, WEEK(exp_date,1) AS week_num, 0 AS new_count, COUNT(DISTINCT corp_idx) AS expired_count
          FROM martjangbogo.ceo c
          CROSS JOIN params p
          WHERE c.exp_date BETWEEN p.first_week_start AND p.last_week_end
            AND c.corp_idx NOT IN (104133,96073,103959,72500)
          GROUP BY YEAR(exp_date), WEEK(exp_date,1)
        ) se
        GROUP BY se.year_num, se.week_num
      ) t ON w.year_num = t.year_num AND w.week_num = t.week_num
      ORDER BY w.year_num DESC, w.week_num DESC
    ) sq
  ),

  -- 7. 월간 신규/만료 마트 (최근 6개월) — 동일한 UNION 방식
  '월간_신규_만료_마트_(최근_6개월)', (
    SELECT JSON_ARRAYAGG(js)
    FROM (
      SELECT JSON_OBJECT(
        '월', CONCAT(m.month_label,' (', m.month_start,'~', m.month_end,')'),
        '신규_마트', IFNULL(t.new_count,0),
        '만료_마트', IFNULL(t.expired_count,0)
      ) AS js
      FROM month_list m
      LEFT JOIN (
        SELECT
          se.month_label,
          SUM(se.new_count) AS new_count,
          SUM(se.expired_count) AS expired_count
        FROM (
          SELECT DATE_FORMAT(approval_date,'%Y년 %m월') AS month_label, COUNT(DISTINCT corp_idx) AS new_count, 0 AS expired_count
          FROM martjangbogo.ceo c
          CROSS JOIN params p
          WHERE c.approval_date BETWEEN p.first_month_start AND p.last_month_end
            AND c.corp_idx NOT IN (104133,96073,103959,72500)
          GROUP BY DATE_FORMAT(approval_date,'%Y년 %m월')

          UNION ALL

          SELECT DATE_FORMAT(exp_date,'%Y년 %m월') AS month_label, 0 AS new_count, COUNT(DISTINCT corp_idx) AS expired_count
          FROM martjangbogo.ceo c
          CROSS JOIN params p
          WHERE c.exp_date BETWEEN p.first_month_start AND p.last_month_end
            AND c.corp_idx NOT IN (104133,96073,103959,72500)
          GROUP BY DATE_FORMAT(exp_date,'%Y년 %m월')
        ) se
        GROUP BY se.month_label
      ) t ON m.month_label = t.month_label
      ORDER BY m.month_label DESC
    ) sq
  )
) AS final_json;`;
