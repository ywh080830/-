// 元答 Supabase 集成模块 - 内联版本
// 依赖: supabase.min.js (需在之前加载)
// 支持离线模式：云端失败时自动降级到本地数据，网络恢复后自动同步
// 统一使用 id_number 作为用户标识（与数据库 schema 一致）

(function() {
    'use strict';

    const SUPABASE_URL = 'https://xskhrdtjflbwfgaflmxc.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_t3OeAJu4Pv7hg0pYNxSnwg_1Tc8Eo5g';

    let supabaseClient = null;
    let userId = null;           // 存储 id_number（整数）
    let isOfflineMode = true;     // 默认离线模式，初始化成功后才改为 false

    // 模型定价配置
    const MODEL_PRICING = { 'qwen': 1, 'deepseek': 2, 'glm': 3, 'kimi': 2, 'oil': 0 };
    // 会员折扣表（与 billing.js 的 MEMBERSHIP_DISCOUNT 保持一致）
    const MEMBERSHIP_DISCOUNT = { free: 1.0, premium: 0.9, pro: 0.7, enterprise: 0.5 };
    let modelDiscounts = {};

    function ensureClient() {
        if (!supabaseClient && window.supabase) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        return supabaseClient;
    }

    // 生成本地临时ID（负数，避免与云端ID冲突）
    function generateLocalId() {
        let localId = localStorage.getItem('yuanda_local_id');
        if (!localId) {
            localId = '-' + Date.now();
            localStorage.setItem('yuanda_local_id', localId);
        }
        return parseInt(localId) || -Date.now();
    }

    // ========== 公开 API ==========
    window.YuanDaSupabase = {

        init: function() {
            ensureClient();
            // 优先读取云端ID（id_number）
            const savedId = localStorage.getItem('yuanda_user_id');
            if (savedId) {
                userId = parseInt(savedId);
                isOfflineMode = false;
            } else {
                // 没有云端ID，检查是否有本地ID
                const localId = localStorage.getItem('yuanda_local_id');
                if (localId) {
                    userId = parseInt(localId);
                }
                isOfflineMode = true;
            }
            console.log('[元答] 初始化完成, userId=' + userId + ', offlineMode=' + isOfflineMode);
            return !!supabaseClient;
        },

        // 分配用户ID（返回 id_number）
        assignUserId: async function() {
            // 已有ID，验证是否仍然有效
            if (userId && userId > 0) {
                const sb = ensureClient();
                if (sb) {
                    try {
                        const { data, error } = await sb
                            .from('user_profile')
                            .select('id_number')
                            .eq('id_number', userId)
                            .single();
                        if (!error && data) {
                            isOfflineMode = false;
                            return userId;
                        }
                    } catch (e) {}
                }
                // 验证失败，继续尝试分配
            }

            // 没有有效ID，尝试从云端分配
            const sb = ensureClient();
            if (sb) {
                try {
                    const { data, error } = await sb.rpc('assign_user_id');
                    if (!error && data) {
                        userId = data;  // data 就是 id_number
                        localStorage.setItem('yuanda_user_id', String(userId));
                        isOfflineMode = false;
                        console.log('[元答] 分配云端ID:', userId);
                        return userId;
                    }
                } catch (e) {
                    console.warn('[元答] 云端分配ID失败:', e.message);
                }
            }

            // 云端失败，生成本地ID（负数）
            userId = generateLocalId();
            isOfflineMode = true;
            console.log('[元答] 使用本地ID（离线模式）:', userId);
            return userId;
        },

        // 同步离线队列到云端（积分系统已移除，当前为空操作，保留接口兼容）
        syncOfflineQueue: async function() {
            // 积分系统已移除，离线队列不再使用，保留为空操作以兼容调用点
            return;
        },

        // 尝试从离线模式切换到在线模式（验证 user_storage 连通性）
        tryGoOnline: async function() {
            const sb = ensureClient();
            if (!sb) return false;

            // 如果没有用户ID，先分配
            if (!userId || userId < 0) {
                const newId = await this.assignUserId();
                return newId > 0;
            }

            // 尝试读取云端 user_storage 验证在线状态
            try {
                const { data, error } = await sb
                    .from('user_storage')
                    .select('id_number')
                    .eq('id_number', userId)
                    .single();
                if (!error && data) {
                    isOfflineMode = false;
                    await this.syncOfflineQueue();
                    console.log('[元答] 已切换到在线模式');
                    return true;
                }
            } catch (e) {
                console.warn('[元答] 尝试上线失败:', e.message);
            }
            return false;
        },

        syncModelPricing: async function() {
            if (isOfflineMode) return MODEL_PRICING;
            const sb = ensureClient();
            if (!sb) return MODEL_PRICING;
            try {
                const { data, error } = await sb.from('app_config').select('config_value').eq('config_key', 'model_pricing').single();
                if (!error && data && data.config_value) Object.assign(MODEL_PRICING, data.config_value);
            } catch (e) {}
            return MODEL_PRICING;
        },

        syncModelDiscounts: async function() {
            if (isOfflineMode) return;
            const sb = ensureClient();
            if (!sb) return;
            try {
                const { data, error } = await sb.from('app_config').select('config_value').eq('config_key', 'model_discounts').single();
                if (!error && data && data.config_value && data.config_value.active) {
                    const discounts = data.config_value.discounts || {};
                    Object.keys(discounts).forEach(key => {
                        const d = discounts[key];
                        const base = MODEL_PRICING[key] || 0;
                        const final = base === 0 ? 0 : Math.max(1, Math.floor(base * (d.rate || 1)));
                        modelDiscounts[key] = { basePrice: base, discountRate: d.rate, finalPrice: final, label: d.label, isDiscounted: d.rate < 1 };
                    });
                }
            } catch (e) {}
        },

        // 会员折扣表见模块顶部 MEMBERSHIP_DISCOUNT（与 billing.js 保持一致）

        // 获取模型最终价格（series 折扣 × 会员折扣）
        // options.membership 不传则按 free 计算（兼容旧调用）
        getModelPrice: function(series, options) {
            const base = MODEL_PRICING[series] || 0;
            const m = modelDiscounts[series] || {};
            const membership = (options && options.membership) || 'free';
            const memberRate = MEMBERSHIP_DISCOUNT[membership] != null ? MEMBERSHIP_DISCOUNT[membership] : 1.0;
            const seriesRate = m.discountRate != null ? m.discountRate : 1.0;
            const finalRate = seriesRate * memberRate;
            const finalPrice = base === 0 ? 0 : Math.max(1, Math.floor(base * finalRate));
            return {
                basePrice: base,
                discountRate: finalRate,            // 叠加后的总折扣
                seriesRate: seriesRate,             // 仅 series 折扣
                memberRate: memberRate,             // 仅会员折扣
                finalPrice: finalPrice,             // 叠加后最终价（积分/次）
                label: m.label || '',
                isDiscounted: finalRate < 1.0
            };
        },

        getClient: function() { return ensureClient(); },
        // 暴露给前端用于 Storage 服务端复制等原始 REST 调用（anon key 本就公开，无泄露风险）
        SUPABASE_URL: SUPABASE_URL,
        SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
        isOfflineMode: function() { return isOfflineMode; },
        getUserId: function() { return userId; },
        // 获取用户资料
        getProfile: async function() {
            if (isOfflineMode || !userId || userId < 0) return null;
            const sb = ensureClient();
            if (!sb) return null;
            try {
                const { data, error } = await sb
                    .from('user_profile')
                    .select('*')
                    .eq('id_number', userId)
                    .single();
                if (error) return null;
                return data;
            } catch (e) { return null; }
        },

        // 从云端加载用户数据 (user_storage 表, 按 id_number 隔离)
        // 返回: { conversations, settings, favorites, stats } 或 null
        loadUserData: async function() {
            if (!userId || userId < 0) return null;
            const sb = ensureClient();
            if (!sb) return null;
            try {
                const { data, error } = await sb
                    .from('user_storage')
                    .select('conversations, settings, favorites, stats')
                    .eq('id_number', userId)
                    .single();
                if (error) {
                    if (error.code === 'PGRST116') {
                        // 记录不存在，兜底创建一条空记录
                        await sb.from('user_storage').upsert({
                            id_number: userId,
                            conversations: {}, settings: {}, favorites: [], stats: {}
                        });
                        return { conversations: {}, settings: {}, favorites: [], stats: {} };
                    }
                    console.warn('[元答] 加载云端数据失败:', error.message);
                    return null;
                }
                return {
                    conversations: data.conversations || {},
                    settings: data.settings || {},
                    favorites: data.favorites || [],
                    stats: data.stats || {}
                };
            } catch (e) {
                console.warn('[元答] 加载云端数据异常:', e.message);
                return null;
            }
        },

        // 保存全部用户数据到云端 (user_storage 表)
        // conversations/settings/favorites/stats 均为 JSONB
        // 返回: true 成功 / false 失败
        saveAllUserData: async function(conversations, settings, favorites, stats) {
            if (!userId || userId < 0) return false;
            const sb = ensureClient();
            if (!sb) return false;
            try {
                const { error } = await sb
                    .from('user_storage')
                    .upsert({
                        id_number: userId,
                        conversations: conversations || {},
                        settings: settings || {},
                        favorites: favorites || [],
                        stats: stats || {}
                    });
                if (error) {
                    console.warn('[元答] 保存云端数据失败:', error.message);
                    return false;
                }
                return true;
            } catch (e) {
                console.warn('[元答] 保存云端数据异常:', e.message);
                return false;
            }
        },

        // 细粒度保存某一类数据 (减少传输体积)
        saveUserDataField: async function(field, value) {
            if (!userId || userId < 0) return false;
            const sb = ensureClient();
            if (!sb) return false;
            try {
                const patch = {};
                patch[field] = value;
                const { error } = await sb
                    .from('user_storage')
                    .update(patch)
                    .eq('id_number', userId);
                if (error) { console.warn('[元答] 更新字段失败:', error.message); return false; }
                return true;
            } catch (e) { return false; }
        },

        // 占位函数（保持兼容性）
        trackVisit: async function() {},
        recycleUserId: async function() {
            if (!userId || userId < 0) return false;
            const sb = ensureClient();
            if (!sb) return false;
            try {
                const { data, error } = await sb.rpc('recycle_user_id', { p_id_number: userId });
                if (error) { console.warn('[元答] 回收ID失败:', error.message); return false; }
                return data === true;
            } catch (e) {
                console.warn('[元答] 回收ID异常:', e.message);
                return false;
            }
        },
        updateProfileStats: function() {},
        checkAppUpdate: async function() { return { hasUpdate: false }; }
    };

    console.log('[元答] Supabase模块已加载（支持离线模式）');
})();
