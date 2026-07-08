-- ============================================================
-- 元答 Supabase 完整数据库配置（已修复 typo）
-- 功能: ID池管理 / 数据存储 / 积分系统 / 个人中心 / 自动更新
-- ============================================================

-- ============================================================
-- 1. ID 池表 - 预生成可用ID池
-- ============================================================
CREATE TABLE IF NOT EXISTS id_pool (
    id_number INTEGER PRIMARY KEY,
    status TEXT DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'recycled')),
    assigned_at TIMESTAMP WITH TIME ZONE,
    recycled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_id_pool_status ON id_pool(status);

-- 预填充 10000 个ID (10001 ~ 20000)
INSERT INTO id_pool (id_number)
SELECT generate_series(10001, 20000)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. 用户存储空间表
-- ============================================================
CREATE TABLE IF NOT EXISTS user_storage (
    id_number INTEGER PRIMARY KEY REFERENCES id_pool(id_number),
    conversations JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    favorites JSONB DEFAULT '[]'::jsonb,
    stats JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 3. 积分账户表
-- ============================================================
CREATE TABLE IF NOT EXISTS points_account (
    id_number INTEGER PRIMARY KEY REFERENCES id_pool(id_number),
    balance INTEGER DEFAULT 1000,
    total_earned INTEGER DEFAULT 1000,
    total_spent INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 4. 积分交易记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS points_transactions (
    id BIGSERIAL PRIMARY KEY,
    id_number INTEGER NOT NULL REFERENCES id_pool(id_number),
    type TEXT NOT NULL CHECK (type IN ('earn', 'spend')),
    amount INTEGER NOT NULL,
    model_name TEXT,
    description TEXT,
    balance_after INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_tx_user ON points_transactions(id_number);
CREATE INDEX IF NOT EXISTS idx_points_tx_created ON points_transactions(created_at);

-- ============================================================
-- 5. 用户个人中心信息表
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profile (
    id_number INTEGER PRIMARY KEY REFERENCES id_pool(id_number),
    nickname TEXT,
    avatar TEXT DEFAULT '',
    model_usage_stats JSONB DEFAULT '{}'::jsonb,
    total_conversations INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 6. APP配置表
-- ============================================================
CREATE TABLE IF NOT EXISTS app_config (
    config_key TEXT PRIMARY KEY,
    config_value JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO app_config (config_key, config_value)
VALUES ('app_version', '{"version": "1.0.0", "code": 100, "update_url": "", "force_update": false, "changelog": "初始化版本"}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO app_config (config_key, config_value)
VALUES ('model_pricing', '{"qwen": 1, "deepseek": 2, "glm": 3, "kimi": 2, "fund": 0, "oil": 0}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO app_config (config_key, config_value)
VALUES ('daily_bonus', '{"amount": 100, "enabled": true}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO app_config (config_key, config_value)
VALUES ('model_discounts', '{
  "active": true,
  "discounts": {
    "glm": { "rate": 0.5, "label": "半价", "start_at": null, "end_at": null },
    "deepseek": { "rate": 0.5, "label": "半价", "start_at": null, "end_at": null },
    "kimi": { "rate": 0.5, "label": "半价", "start_at": null, "end_at": null }
  }
}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================
-- 7. 访问统计表
-- ============================================================
CREATE TABLE IF NOT EXISTS visits (
    id BIGSERIAL PRIMARY KEY,
    date DATE UNIQUE NOT NULL,
    count INTEGER DEFAULT 0,
    unique_visitors TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);

INSERT INTO visits (date, count, unique_visitors)
VALUES (CURRENT_DATE, 0, '{}')
ON CONFLICT (date) DO NOTHING;

-- ============================================================
-- 8. 行级安全策略 (RLS)
-- ============================================================
ALTER TABLE id_pool ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "id_pool_read" ON id_pool;
CREATE POLICY "id_pool_read" ON id_pool FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "id_pool_write" ON id_pool;
CREATE POLICY "id_pool_write" ON id_pool FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE user_storage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_storage_read" ON user_storage;
CREATE POLICY "user_storage_read" ON user_storage FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "user_storage_write" ON user_storage;
CREATE POLICY "user_storage_write" ON user_storage FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE points_account ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "points_account_read" ON points_account;
CREATE POLICY "points_account_read" ON points_account FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "points_account_write" ON points_account;
CREATE POLICY "points_account_write" ON points_account FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "points_tx_read" ON points_transactions;
CREATE POLICY "points_tx_read" ON points_transactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "points_tx_write" ON points_transactions;
CREATE POLICY "points_tx_write" ON points_transactions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_profile_read" ON user_profile;
CREATE POLICY "user_profile_read" ON user_profile FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "user_profile_write" ON user_profile;
CREATE POLICY "user_profile_write" ON user_profile FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_config_read" ON app_config;
CREATE POLICY "app_config_read" ON app_config FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app_config_write" ON app_config;
CREATE POLICY "app_config_write" ON app_config FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visits_read" ON visits;
CREATE POLICY "visits_read" ON visits FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "visits_insert" ON visits;
CREATE POLICY "visits_insert" ON visits FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "visits_update" ON visits;
CREATE POLICY "visits_update" ON visits FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 9. 触发器: 自动更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_user_storage_updated_at ON user_storage;
CREATE TRIGGER update_user_storage_updated_at
    BEFORE UPDATE ON user_storage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_points_account_updated_at ON points_account;
CREATE TRIGGER update_points_account_updated_at
    BEFORE UPDATE ON points_account
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_profile_updated_at ON user_profile;
CREATE TRIGGER update_user_profile_updated_at
    BEFORE UPDATE ON user_profile
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_config_updated_at ON app_config;
CREATE TRIGGER update_app_config_updated_at
    BEFORE UPDATE ON app_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_visits_updated_at ON visits;
CREATE TRIGGER update_visits_updated_at
    BEFORE UPDATE ON visits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 10. 存储过程: 分配用户ID
-- ============================================================
CREATE OR REPLACE FUNCTION assign_user_id()
RETURNS INTEGER AS $$
DECLARE
    assigned_id INTEGER;
BEGIN
    SELECT id_number INTO assigned_id
    FROM id_pool
    WHERE status = 'available'
    ORDER BY id_number
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF assigned_id IS NULL THEN
        RAISE EXCEPTION 'ID pool exhausted, no available IDs';
    END IF;

    UPDATE id_pool
    SET status = 'in_use', assigned_at = NOW()
    WHERE id_number = assigned_id;

    INSERT INTO user_storage (id_number, conversations, settings, favorites, stats)
    VALUES (assigned_id, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)
    ON CONFLICT (id_number) DO NOTHING;

    INSERT INTO points_account (id_number, balance, total_earned, total_spent)
    VALUES (assigned_id, 1000, 1000, 0)
    ON CONFLICT (id_number) DO NOTHING;

    INSERT INTO user_profile (id_number, nickname, model_usage_stats, total_conversations, total_messages)
    VALUES (assigned_id, '用户' || assigned_id, '{}'::jsonb, 0, 0)
    ON CONFLICT (id_number) DO NOTHING;

    INSERT INTO points_transactions (id_number, type, amount, description, balance_after)
    VALUES (assigned_id, 'earn', 1000, '新用户注册赠送', 1000);

    RETURN assigned_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. 存储过程: 回收用户ID
-- ============================================================
CREATE OR REPLACE FUNCTION recycle_user_id(p_id_number INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE user_storage
    SET conversations = '{}'::jsonb,
        settings = '{}'::jsonb,
        favorites = '[]'::jsonb,
        stats = '{}'::jsonb
    WHERE id_number = p_id_number;

    UPDATE points_account
    SET balance = 0, total_spent = total_spent
    WHERE id_number = p_id_number;

    UPDATE user_profile
    SET nickname = NULL,
        avatar = '',
        model_usage_stats = '{}'::jsonb,
        total_conversations = 0,
        total_messages = 0
    WHERE id_number = p_id_number;

    UPDATE id_pool
    SET status = 'recycled', recycled_at = NOW()
    WHERE id_number = p_id_number AND status = 'in_use';

    UPDATE id_pool
    SET status = 'available'
    WHERE id_number = p_id_number AND status = 'recycled';

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. 存储过程: 积分扣费
-- ============================================================
CREATE OR REPLACE FUNCTION spend_points(p_id_number INTEGER, p_amount INTEGER, p_model_name TEXT, p_description TEXT)
RETURNS TABLE(success BOOLEAN, new_balance INTEGER, message TEXT) AS $$
DECLARE
    current_balance INTEGER;
BEGIN
    SELECT balance INTO current_balance
    FROM points_account
    WHERE id_number = p_id_number
    FOR UPDATE;

    IF current_balance IS NULL THEN
        RETURN QUERY SELECT false, 0, '账户不存在'::TEXT;
        RETURN;
    END IF;

    IF current_balance < p_amount THEN
        RETURN QUERY SELECT false, current_balance, '积分不足'::TEXT;
        RETURN;
    END IF;

    UPDATE points_account
    SET balance = balance - p_amount,
        total_spent = total_spent + p_amount
    WHERE id_number = p_id_number;

    INSERT INTO points_transactions (id_number, type, amount, model_name, description, balance_after)
    VALUES (p_id_number, 'spend', p_amount, p_model_name, p_description, current_balance - p_amount);

    RETURN QUERY SELECT true, current_balance - p_amount, '扣费成功'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12.5 存储过程: 获取模型实际价格 (含折扣)
-- ============================================================
CREATE OR REPLACE FUNCTION get_model_price(p_model_series TEXT)
RETURNS TABLE(base_price INTEGER, discount_rate REAL, final_price INTEGER, discount_label TEXT, is_discounted BOOLEAN) AS $$
DECLARE
    base_pricing JSONB;
    discount_config JSONB;
    model_discount JSONB;
    base_val INTEGER;
    rate_val REAL;
    label_val TEXT;
    final_val INTEGER;
    now_ts TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
    SELECT config_value INTO base_pricing
    FROM app_config
    WHERE config_key = 'model_pricing';

    base_val := COALESCE((base_pricing->>p_model_series)::INTEGER, 0);

    SELECT config_value INTO discount_config
    FROM app_config
    WHERE config_key = 'model_discounts';

    rate_val := 1.0;
    label_val := '';

    IF discount_config IS NOT NULL AND (discount_config->>'active')::BOOLEAN = true THEN
        model_discount := discount_config->'discounts'->p_model_series;
        IF model_discount IS NOT NULL THEN
            rate_val := COALESCE((model_discount->>'rate')::REAL, 1.0);
            label_val := COALESCE(model_discount->>'label', '');

            IF model_discount->>'start_at' IS NOT NULL THEN
                IF now_ts < (model_discount->>'start_at')::TIMESTAMP WITH TIME ZONE THEN
                    rate_val := 1.0;
                    label_val := '';
                END IF;
            END IF;

            IF model_discount->>'end_at' IS NOT NULL AND rate_val < 1.0 THEN
                IF now_ts > (model_discount->>'end_at')::TIMESTAMP WITH TIME ZONE THEN
                    rate_val := 1.0;
                    label_val := '';
                END IF;
            END IF;
        END IF;
    END IF;

    IF base_val = 0 THEN
        final_val := 0;
    ELSE
        final_val := GREATEST(1, FLOOR(base_val * rate_val)::INTEGER);
    END IF;

    RETURN QUERY SELECT base_val, rate_val, final_val, label_val, (rate_val < 1.0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 13. 存储过程: 积分充值/奖励
-- ============================================================
CREATE OR REPLACE FUNCTION earn_points(p_id_number INTEGER, p_amount INTEGER, p_description TEXT)
RETURNS TABLE(success BOOLEAN, new_balance INTEGER) AS $$
DECLARE
    current_balance INTEGER;
BEGIN
    SELECT balance INTO current_balance
    FROM points_account
    WHERE id_number = p_id_number
    FOR UPDATE;

    IF current_balance IS NULL THEN
        RETURN QUERY SELECT false, 0;
        RETURN;
    END IF;

    UPDATE points_account
    SET balance = balance + p_amount,
        total_earned = total_earned + p_amount
    WHERE id_number = p_id_number;

    INSERT INTO points_transactions (id_number, type, amount, description, balance_after)
    VALUES (p_id_number, 'earn', p_amount, p_description, current_balance + p_amount);

    RETURN QUERY SELECT true, current_balance + p_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 14. 存储过程: 更新用户个人中心统计
-- ============================================================
CREATE OR REPLACE FUNCTION update_profile_stats(p_id_number INTEGER, p_model_name TEXT, p_msg_count INTEGER)
RETURNS VOID AS $$
DECLARE
    current_stats JSONB;
    new_count INTEGER;
BEGIN
    SELECT model_usage_stats INTO current_stats
    FROM user_profile
    WHERE id_number = p_id_number;

    IF current_stats IS NULL THEN
        current_stats := '{}'::jsonb;
    END IF;

    new_count := COALESCE((current_stats->>p_model_name)::INTEGER, 0) + 1;
    current_stats := current_stats || jsonb_build_object(p_model_name, new_count);

    UPDATE user_profile
    SET model_usage_stats = current_stats,
        total_conversations = total_conversations + 1,
        total_messages = total_messages + p_msg_count,
        last_active_at = NOW()
    WHERE id_number = p_id_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 15. 存储过程: 检查每日签到奖励
-- ============================================================
CREATE OR REPLACE FUNCTION check_daily_bonus(p_id_number INTEGER)
RETURNS TABLE(eligible BOOLEAN, bonus_amount INTEGER) AS $$
DECLARE
    last_bonus_date DATE;
    bonus_config JSONB;
    bonus_amount_val INTEGER;
BEGIN
    SELECT config_value INTO bonus_config
    FROM app_config
    WHERE config_key = 'daily_bonus';

    bonus_amount_val := COALESCE((bonus_config->>'amount')::INTEGER, 100);

    SELECT DATE(created_at) INTO last_bonus_date
    FROM points_transactions
    WHERE id_number = p_id_number AND type = 'earn' AND description LIKE '%每日签到%'
    ORDER BY created_at DESC
    LIMIT 1;

    IF last_bonus_date IS NULL OR last_bonus_date < CURRENT_DATE THEN
        RETURN QUERY SELECT true, bonus_amount_val;
    ELSE
        RETURN QUERY SELECT false, 0;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
