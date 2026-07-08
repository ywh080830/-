-- ============================================================
-- 元答 DaxPay 支付系统 数据库扩展
-- 用法：在 Supabase SQL Editor 中执行本文件（可重复执行）
-- 不影响现有的 supabase_setup.sql，可独立部署
-- ============================================================

-- ============================================================
-- 1. 扩展 user_profile：增加会员相关字段
-- ============================================================
ALTER TABLE user_profile
    ADD COLUMN IF NOT EXISTS membership TEXT DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS member_expire_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS member_started_at TIMESTAMP WITH TIME ZONE;

-- membership 取值：free / basic / pro / premium
ALTER TABLE user_profile
    DROP CONSTRAINT IF EXISTS user_profile_membership_check;
ALTER TABLE user_profile
    ADD CONSTRAINT user_profile_membership_check
    CHECK (membership IN ('free', 'basic', 'pro', 'premium', 'enterprise'));

CREATE INDEX IF NOT EXISTS idx_user_profile_membership ON user_profile(membership);

-- ============================================================
-- 2. 放宽 points_transactions.type 约束（兼容签到/月赠/充值等类型）
-- ============================================================
ALTER TABLE points_transactions
    DROP CONSTRAINT IF EXISTS points_transactions_type_check;
ALTER TABLE points_transactions
    ADD CONSTRAINT points_transactions_type_check
    CHECK (type IN ('earn', 'spend', 'bonus', 'monthly', 'purchase', 'refund', 'membership'));

-- ============================================================
-- 3. 支付订单流水表
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_orders (
    id BIGSERIAL PRIMARY KEY,
    biz_order_no TEXT UNIQUE NOT NULL,           -- 业务订单号（前端生成）
    daxpay_order_no TEXT,                       -- DaxPay 自己的订单号
    user_id INTEGER REFERENCES id_pool(id_number),
    biz_type TEXT NOT NULL CHECK (biz_type IN ('points', 'membership')),
    title TEXT,
    amount INTEGER NOT NULL,                    -- 单位：分
    channel TEXT,                               -- wechat_h5 / alipay_h5
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'closed', 'refunded')),
    raw_attach JSONB,                           -- 下单时透传的业务参数
    paid_at TIMESTAMP WITH TIME ZONE,
    failed_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created ON payment_orders(created_at DESC);

-- 自动更新 updated_at
DROP TRIGGER IF EXISTS update_payment_orders_updated_at ON payment_orders;
CREATE TRIGGER update_payment_orders_updated_at
    BEFORE UPDATE ON payment_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. 行级安全策略（payment_orders）
-- ============================================================
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_orders_read" ON payment_orders;
CREATE POLICY "payment_orders_read" ON payment_orders
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "payment_orders_insert" ON payment_orders;
CREATE POLICY "payment_orders_insert" ON payment_orders
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "payment_orders_update" ON payment_orders;
CREATE POLICY "payment_orders_update" ON payment_orders
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 5. 会员套餐配置（写入 app_config，前端读取展示）
-- ============================================================
INSERT INTO app_config (config_key, config_value)
VALUES (
    'membership_plans',
    '{
        "plans": [
            {"id": "basic",    "name": "基础会员", "monthly_price": 1990, "yearly_price": 19900, "monthly_points": 500,  "monthly_bonus": 20,  "model_discount": 0.9},
            {"id": "pro",      "name": "专业会员", "monthly_price": 4900, "yearly_price": 49000, "monthly_points": 2000, "monthly_bonus": 50,  "model_discount": 0.7},
            {"id": "premium",  "name": "高级会员", "monthly_price": 9900, "yearly_price": 99000, "monthly_points": 5000, "monthly_bonus": 100, "model_discount": 0.5}
        ]
    }'::jsonb
)
ON CONFLICT (config_key) DO UPDATE
    SET config_value = EXCLUDED.config_value,
        updated_at = NOW();

-- 积分加量包配置
INSERT INTO app_config (config_key, config_value)
VALUES (
    'points_packages',
    '{
        "packages": [
            {"points": 1000,  "price": 990,   "label": "约 0.01元/积分"},
            {"points": 5000,  "price": 3990,  "label": "约 0.008元/积分"},
            {"points": 10000, "price": 6990,  "label": "约 0.007元/积分"},
            {"points": 50000, "price": 29900, "label": "约 0.006元/积分"}
        ]
    }'::jsonb
)
ON CONFLICT (config_key) DO UPDATE
    SET config_value = EXCLUDED.config_value,
        updated_at = NOW();

-- ============================================================
-- 6. 视图：用户会员信息（前端查询用）
-- ============================================================
CREATE OR REPLACE VIEW user_membership_view AS
SELECT
    p.id_number,
    p.membership,
    p.member_expire_at,
    p.member_started_at,
    CASE
        WHEN p.member_expire_at IS NULL THEN false
        WHEN p.member_expire_at < NOW() THEN false
        ELSE true
    END AS is_active,
    EXTRACT(DAY FROM (p.member_expire_at - NOW()))::INTEGER AS days_remaining
FROM user_profile p;

-- ============================================================
-- 7. 签到扩展：连续签到字段 + 历史表
-- ============================================================
ALTER TABLE user_profile
    ADD COLUMN IF NOT EXISTS signin_streak INTEGER DEFAULT 0,           -- 当前连续签到天数
    ADD COLUMN IF NOT EXISTS signin_best_streak INTEGER DEFAULT 0,     -- 历史最长连续
    ADD COLUMN IF NOT EXISTS signin_total_days INTEGER DEFAULT 0,      -- 累计签到天数
    ADD COLUMN IF NOT EXISTS last_signin_date DATE;                    -- 上次签到日期
    ADD COLUMN IF NOT EXISTS last_signin_bonus INTEGER DEFAULT 0;      -- 上次签到奖励积分

CREATE INDEX IF NOT EXISTS idx_user_profile_last_signin ON user_profile(last_signin_date);

-- 签到历史流水表
CREATE TABLE IF NOT EXISTS signin_history (
    id BIGSERIAL PRIMARY KEY,
    id_number INTEGER REFERENCES id_pool(id_number),
    signin_date DATE NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0,
    bonus_type TEXT DEFAULT 'daily' CHECK (bonus_type IN ('daily', 'streak', 'monthly')),
    is_remedy BOOLEAN DEFAULT false,                                  -- 是否补签
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(id_number, signin_date)                                    -- 同一天只能签一次
);

CREATE INDEX IF NOT EXISTS idx_signin_history_user ON signin_history(id_number);
CREATE INDEX IF NOT EXISTS idx_signin_history_date ON signin_history(signin_date DESC);

-- 行级安全策略
ALTER TABLE signin_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signin_history_read" ON signin_history;
CREATE POLICY "signin_history_read" ON signin_history
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "signin_history_insert" ON signin_history;
CREATE POLICY "signin_history_insert" ON signin_history
    FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ============================================================
-- 8. 签到奖励规则（写入 app_config，前端读取展示）
-- ============================================================
INSERT INTO app_config (config_key, config_value)
VALUES (
    'signin_rewards',
    '{
        "daily_base": 10,
        "streak_bonuses": [
            {"days": 3,  "bonus": 20,  "label": "连签 3 天额外奖"},
            {"days": 7,  "bonus": 50,  "label": "连签 7 天额外奖"},
            {"days": 14, "bonus": 150, "label": "连签 14 天额外奖"},
            {"days": 30, "bonus": 500, "label": "连签 30 天大满贯"}
        ],
        "monthly_extra": 200,
        "remedy_cost": 50
    }'::jsonb
)
ON CONFLICT (config_key) DO UPDATE
    SET config_value = EXCLUDED.config_value,
        updated_at = NOW();

-- ============================================================
-- 9. 完成提示
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '✅ DaxPay 数据库扩展部署完成';
    RAISE NOTICE '   - user_profile 已增加 membership / member_expire_at 字段';
    RAISE NOTICE '   - points_transactions.type 约束已扩展（兼容 purchase/bonus/monthly）';
    RAISE NOTICE '   - payment_orders 表已创建';
    RAISE NOTICE '   - app_config 中已写入 membership_plans / points_packages';
    RAISE NOTICE '   - signin_history 表已创建（30天月历签到用）';
    RAISE NOTICE '   - user_profile 已增加签到连续天数字段';
    RAISE NOTICE '   - app_config 中已写入 signin_rewards（签到奖励规则）';
END $$;
