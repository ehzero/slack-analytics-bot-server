// 주간 보고서용 SQL: JSON 객체 반환
export const WEEKLY_ANALYTICS_SQL = `
SELECT JSON_OBJECT(
    -- case1: 주 단위 비교 (지난주 vs 지지난주)
    '주간_비교',
	(
	    SELECT JSON_ARRAYAGG(
	        JSON_OBJECT(
	            'week_label', CONCAT(year, '년 ', month, '월 ', week_num, '주차'),
	            'save_pamphlet', save_pamphlet_count,
	            'send_message', send_message_count,
	            'print_pop', print_pop_count
	        )
	    )
	    FROM (
	        SELECT 
	            YEAR(ins_date) AS year,
	            MONTH(ins_date) AS month,
	            FLOOR((DAY(ins_date)-1)/7)+1 AS week_num,
	            SUM(CASE WHEN user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
	            SUM(CASE WHEN user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
	            SUM(CASE WHEN user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
	        FROM martjangbogo.user_action
	        WHERE YEAR(ins_date) = YEAR(CURDATE())
	          AND WEEK(ins_date, 1) IN (WEEK(CURDATE(), 1)-1, WEEK(CURDATE(), 1)-2)
	          AND user_action_type IN ('save_pamphlet', 'send_message', 'print_pop')
	        GROUP BY YEAR(ins_date), WEEK(ins_date, 1)
	        ORDER BY YEAR(ins_date) DESC, WEEK(ins_date, 1) DESC
	    ) t
	),

    -- case2: 월 단위 비교 (지난달 vs 지지난달)
    '월간_비교',
    (
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'year', year,
            'month', month,
            'save_pamphlet', save_pamphlet_count,
            'send_message', send_message_count,
            'print_pop', print_pop_count
        ))
        FROM (
            SELECT YEAR(ins_date) AS year,
                   MONTH(ins_date) AS month,
                   SUM(CASE WHEN user_action_type='save_pamphlet' THEN 1 ELSE 0 END) AS save_pamphlet_count,
                   SUM(CASE WHEN user_action_type='send_message' THEN 1 ELSE 0 END) AS send_message_count,
                   SUM(CASE WHEN user_action_type='print_pop' THEN 1 ELSE 0 END) AS print_pop_count
            FROM martjangbogo.user_action
            WHERE (
                   (YEAR(ins_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(ins_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)))
                OR (YEAR(ins_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 2 MONTH)) AND MONTH(ins_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 2 MONTH)))
            )
            AND user_action_type IN ('save_pamphlet','send_message','print_pop')
            GROUP BY year, month
            ORDER BY year DESC, month DESC
        ) t
    ),

    -- case3: 요일별 비교 (최근 30일 기준)
    '요일별_비교_최근30일',
    (
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

	 -- case4: 마트별 이벤트 통계 (total 기준 내림차순 정렬)
    '마트별_이벤트통계_최근30일',
    (
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
                SUM(CASE WHEN ua.user_action_type IN ('save_pamphlet', 'send_message', 'print_pop') THEN 1 ELSE 0 END) AS total
            FROM martjangbogo.user_action ua
            JOIN martjangbogo.ceo c ON c.ceo_idx = ua.ceo_idx
            JOIN martjangbogo.tbl_corp corp ON corp.corp_idx = c.corp_idx
            WHERE ua.ins_date >= NOW() - INTERVAL 30 DAY
              AND ua.user_action_type IN ('save_pamphlet', 'send_message', 'print_pop')
            GROUP BY corp.corp_idx, corp.corp_name
            ORDER BY total DESC
        ) t
    ),

    -- case5: POP 템플릿 카테고리 통계
    'POP_템플릿_카테고리_통계_최근30일',
    (
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'category', category,
                'count', cnt
            )
        )
        FROM (
            SELECT JSON_UNQUOTE(JSON_EXTRACT(extra_data,'$.category')) AS category,
                   COUNT(*) AS cnt
            FROM martjangbogo.user_action
            WHERE ins_date >= NOW() - INTERVAL 30 DAY
              AND user_action_type='print_pop'
              AND JSON_EXTRACT(extra_data,'$.category') IS NOT NULL
            GROUP BY category
        ) AS t
    )
) AS final_json;`;
