// 주간 보고서용 SQL: JSON 객체 반환
export const WEEKLY_ANALYTICS_SQL = `WITH RECURSIVE
-- 최근 5주
weeks AS (
    SELECT 0 AS offset
    UNION ALL
    SELECT offset + 1
    FROM weeks
    WHERE offset < 4
),
week_list AS (
    SELECT 
        YEAR(DATE_SUB(CURDATE(), INTERVAL offset WEEK)) AS year_num,
        WEEK(DATE_SUB(CURDATE(), INTERVAL offset WEEK),1) AS week_num,
        DATE_FORMAT(DATE_SUB(DATE_SUB(CURDATE(), INTERVAL offset WEEK), INTERVAL WEEKDAY(DATE_SUB(CURDATE(), INTERVAL offset WEEK)) DAY), '%m-%d') AS week_start,
        DATE_FORMAT(DATE_ADD(DATE_SUB(DATE_SUB(CURDATE(), INTERVAL offset WEEK), INTERVAL WEEKDAY(DATE_SUB(CURDATE(), INTERVAL offset WEEK)) DAY), INTERVAL 6 DAY), '%m-%d') AS week_end
    FROM weeks
),
-- 최근 6개월
months AS (
    SELECT 0 AS offset
    UNION ALL
    SELECT offset + 1
    FROM months
    WHERE offset < 5
),
month_list AS (
    SELECT 
        DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL offset MONTH), '%Y년 %m월') AS month_label,
        DATE_FORMAT(DATE_SUB(DATE_SUB(CURDATE(), INTERVAL offset MONTH), INTERVAL DAY(DATE_SUB(CURDATE(), INTERVAL offset MONTH))-1 DAY), '%m-%d') AS month_start,
        DATE_FORMAT(LAST_DAY(DATE_SUB(CURDATE(), INTERVAL offset MONTH)), '%m-%d') AS month_end
    FROM months
)
SELECT JSON_OBJECT(
    -- 1. 주간 로그 통계
    '주간_로그_통계', (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            '주', CONCAT(w.year_num,'년 ', w.week_num,'주차 (', w.week_start,'~', w.week_end,')'),
            'save_pamphlet', IFNULL(t.save_pamphlet_count,0),
            'send_message', IFNULL(t.send_message_count,0),
            'print_pop', IFNULL(t.print_pop_count,0)
        ))
        FROM week_list w
        LEFT JOIN (
            SELECT 
                YEAR(ins_date) AS year_num,
                WEEK(ins_date,1) AS week_num,
                SUM(CASE WHEN user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
                SUM(CASE WHEN user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
                SUM(CASE WHEN user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
            FROM martjangbogo.user_action
            WHERE ins_date >= DATE_SUB(CURDATE(), INTERVAL 35 DAY)
              AND user_action_type IN ('save_pamphlet','send_message','print_pop')
            GROUP BY YEAR(ins_date), WEEK(ins_date,1)
        ) t ON w.year_num = t.year_num AND w.week_num = t.week_num
        ORDER BY w.year_num DESC, w.week_num DESC
    ),

    -- 2. 월간 로그 통계 (최근 6개월)
    '월간_로그_통계', (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            '월', CONCAT(m.month_label,' (', m.month_start,'~', m.month_end,')'),
            'save_pamphlet', IFNULL(t.save_pamphlet_count,0),
            'send_message', IFNULL(t.send_message_count,0),
            'print_pop', IFNULL(t.print_pop_count,0)
        ))
        FROM month_list m
        LEFT JOIN (
            SELECT 
                DATE_FORMAT(ins_date,'%Y년 %m월') AS month_label,
                SUM(CASE WHEN user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
                SUM(CASE WHEN user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
                SUM(CASE WHEN user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
            FROM martjangbogo.user_action
            WHERE ins_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
              AND user_action_type IN ('save_pamphlet','send_message','print_pop')
            GROUP BY month_label
        ) t ON m.month_label = t.month_label
        ORDER BY m.month_label DESC
    ),

    -- 3. 요일별 로그 통계
    '요일별_로그_통계', (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'weekday', weekday_name,
            'save_pamphlet', save_pamphlet_count,
            'send_message', send_message_count,
            'print_pop', print_pop_count
        ))
        FROM (
            SELECT CASE DAYOFWEEK(ins_date)
                       WHEN 1 THEN '일요일'
                       WHEN 2 THEN '월요일'
                       WHEN 3 THEN '화요일'
                       WHEN 4 THEN '수요일'
                       WHEN 5 THEN '목요일'
                       WHEN 6 THEN '금요일'
                       WHEN 7 THEN '토요일'
                   END AS weekday_name,
                   SUM(CASE WHEN user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
                   SUM(CASE WHEN user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
                   SUM(CASE WHEN user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count,
                   DAYOFWEEK(ins_date) AS weekday_number
            FROM martjangbogo.user_action
            WHERE ins_date >= NOW() - INTERVAL 30 DAY
              AND user_action_type IN ('save_pamphlet','send_message','print_pop')
            GROUP BY weekday_number
            ORDER BY FIELD(weekday_number,2,3,4,5,6,7,1)
        ) t
    ),

    -- 4. 마트별 로그 통계
    '마트별_로그_통계', (
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
            WHERE ua.ins_date >= NOW() - INTERVAL 30 DAY
              AND ua.user_action_type IN ('save_pamphlet','send_message','print_pop')
            GROUP BY corp.corp_idx, corp.corp_name
            ORDER BY total DESC
        ) t
    ),

    -- 5. 현재 활성 마트
    '현재_활성_마트', (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'corp_idx', c.corp_idx,
            'corp_name', t.corp_name,
            'approval_date', DATE_FORMAT(c.approval_date,'%Y-%m-%d'),
            'exp_date', DATE_FORMAT(c.exp_date,'%Y-%m-%d')
        ))
        FROM martjangbogo.ceo c
        LEFT JOIN martjangbogo.tbl_corp t ON c.corp_idx = t.corp_idx
        WHERE c.approval_date IS NOT NULL
          AND c.exp_date >= CURDATE()
          AND c.corp_idx NOT IN (104133,96073,103959,72500)
    ),

    -- 6. 주간 신규/만료 마트
    '주간_신규만료_마트', (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            '주', CONCAT(w.year_num,'년 ', w.week_num,'주차 (', w.week_start,'~', w.week_end,')'),
            '신규_마트', IFNULL(t.new_count,0),
            '만료_마트', IFNULL(t.expired_count,0)
        ))
        FROM week_list w
        LEFT JOIN (
            SELECT 
                YEAR(approval_date) AS year_num,
                WEEK(approval_date,1) AS week_num,
                COUNT(DISTINCT corp_idx) AS new_count,
                COUNT(DISTINCT CASE 
                    WHEN exp_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 35 DAY) AND CURDATE()
                    THEN corp_idx 
                END) AS expired_count
            FROM martjangbogo.ceo
            WHERE approval_date IS NOT NULL
              AND corp_idx NOT IN (104133,96073,103959,72500)
            GROUP BY YEAR(approval_date), WEEK(approval_date,1)
        ) t ON w.year_num = t.year_num AND w.week_num = t.week_num
        ORDER BY w.year_num DESC, w.week_num DESC
    ),

    -- 7. 월간 신규/만료 마트 (최근 6개월)
    '월간_신규만료_마트', (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            '월', CONCAT(m.month_label,' (', m.month_start,'~', m.month_end,')'),
            '신규_마트', IFNULL(t.new_count,0),
            '만료_마트', IFNULL(t.expired_count,0)
        ))
        FROM month_list m
        LEFT JOIN (
            SELECT 
                DATE_FORMAT(approval_date,'%Y년 %m월') AS month_label,
                COUNT(DISTINCT corp_idx) AS new_count,
                COUNT(DISTINCT CASE 
                    WHEN exp_date BETWEEN DATE_SUB(LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 6 MONTH)), INTERVAL DAY(LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 6 MONTH)))-1 DAY)
                                        AND LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                    THEN corp_idx 
                END) AS expired_count
            FROM martjangbogo.ceo
            WHERE approval_date IS NOT NULL
              AND corp_idx NOT IN (104133,96073,103959,72500)
            GROUP BY month_label
        ) t ON m.month_label = t.month_label
        ORDER BY m.month_label DESC
    )
) AS final_json;`;
