-- 修复 spend_points 函数：改用 user_id 而不是 id_number
CREATE OR REPLACE FUNCTION spend_points(
    p_user_id INTEGER,
    p_amount INTEGER,
    p_model_name TEXT DEFAULT '',
    p_description TEXT DEFAULT ''
) RETURNS TABLE(success BOOLEAN, new_balance INTEGER, message TEXT) AS $$
DECLARE
    curr_balance INTEGER;
BEGIN
    -- 查找当前积分（用 user_id 查询）
    SELECT balance INTO curr_balance FROM points_account WHERE user_id = p_user_id;
    IF curr_balance IS NULL THEN
        RETURN QUERY SELECT FALSE, 0, '账户不存在';
        RETURN;
    END IF;
    IF curr_balance < p_amount THEN
        RETURN QUERY SELECT FALSE, curr_balance, '积分不足';
        RETURN;
    END IF;
    -- 更新积分
    UPDATE points_account 
    SET balance = curr_balance - p_amount,
        total_spent = total_spent + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    RETURN QUERY SELECT TRUE, curr_balance - p_amount, '扣费成功';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- points_transactions 表添加 balance_after 字段（可选）
ALTER TABLE points_transactions ADD COLUMN IF NOT EXISTS balance_after INTEGER;

-- 确认 user_profile 表有 last_sign_in 和 last_monthly_bonus 字段
-- 如果没有，执行下面两行：
-- ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS last_sign_in DATE;
-- ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS last_monthly_bonus DATE;
