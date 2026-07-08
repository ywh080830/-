/**
 * 元答 - 30天月历签到模块
 *
 * 数据源：
 *   - signin_history 表（每日签到记录）
 *   - user_profile.signin_streak / signin_best_streak / signin_total_days / last_signin_date
 *   - app_config.signin_rewards（签到奖励规则）
 *
 * 业务规则：
 *   - 每天只能签一次（signin_history 唯一约束）
 *   - 连续签到：当天日期 - last_signin_date = 1 → streak + 1
 *   - 中断：差 > 1 → streak 重置为 1
 *   - 首次签到：streak = 1
 *   - 奖励：每日基础（10） + 会员加成 + 连签额外（3/7/14/30）
 *   - 月赠：每月首次登录补 +200（由 supabase-inline.js 的 checkMonthlyBonus 处理）
 *
 * 暴露：
 *   window.YuanDaSignin = {
 *     show(), hide(),
 *     claim(),                 // 今日签到，返回 { ok, bonus, streak, message }
 *     getStatus(),             // { lastDate, streak, total, history }
 *     onUpdate: fn,            // 签到 / 状态变更回调
 *   }
 */

(function() {
    'use strict';

    // ========== 工具 ==========
    function fmtDate(d) {
        if (!(d instanceof Date)) d = new Date(d);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function daysBetween(a, b) {
        const da = new Date(fmtDate(a));
        const db = new Date(fmtDate(b));
        return Math.round((db - da) / 86400000);
    }
    function nowISO() { return new Date().toISOString(); }

    // ========== 奖励规则 ==========
    const DEFAULT_REWARDS = {
        daily_base: 10,
        streak_bonuses: [
            { days: 3,  bonus: 20,  label: '连签 3 天额外奖' },
            { days: 7,  bonus: 50,  label: '连签 7 天额外奖' },
            { days: 14, bonus: 150, label: '连签 14 天额外奖' },
            { days: 30, bonus: 500, label: '连签 30 天大满贯' }
        ]
    };
    const MEMBER_BONUS = { free: 0, basic: 5, pro: 20, premium: 50, enterprise: 100 };

    let _cachedRewards = null;
    async function loadRewards() {
        if (_cachedRewards) return _cachedRewards;
        try {
            const sb = window.YuanDaSupabase.getClient();
            if (!sb) return DEFAULT_REWARDS;
            const r = await sb.from('app_config').select('config_value').eq('config_key', 'signin_rewards').single();
            if (r.error || !r.data) return DEFAULT_REWARDS;
            return Object.assign({}, DEFAULT_REWARDS, r.data.config_value);
        } catch (e) { return DEFAULT_REWARDS; }
    }

    // 计算连签奖励（取最高匹配档位）
    function pickStreakBonus(streak, list) {
        let best = null;
        for (const item of list) {
            if (streak >= item.days && (!best || item.days > best.days)) best = item;
        }
        return best;
    }

    // ========== 签到状态读取 ==========
    async function getStatus() {
        const userId = window.YuanDaSupabase.getUserId();
        if (!userId || userId < 0) return { lastDate: null, streak: 0, total: 0, best: 0, history: [] };

        const sb = window.YuanDaSupabase.getClient();
        if (!sb) return { lastDate: null, streak: 0, total: 0, best: 0, history: [] };

        // 用户档案
        const pRes = await sb.from('user_profile')
            .select('signin_streak, signin_best_streak, signin_total_days, last_signin_date, membership')
            .eq('id_number', userId).single();
        if (pRes.error) return { lastDate: null, streak: 0, total: 0, best: 0, history: [] };

        // 最近 30 天签到历史
        const since = new Date(); since.setDate(since.getDate() - 30);
        const hRes = await sb.from('signin_history')
            .select('signin_date, streak, bonus, bonus_type, is_remedy')
            .eq('id_number', userId)
            .gte('signin_date', fmtDate(since))
            .order('signin_date', { ascending: false });

        return {
            lastDate: pRes.data.last_signin_date || null,
            streak: pRes.data.signin_streak || 0,
            total: pRes.data.signin_total_days || 0,
            best: pRes.data.signin_best_streak || 0,
            membership: pRes.data.membership || 'free',
            history: hRes.data || [],
        };
    }

    // ========== 签到 ==========
    async function claim() {
        const userId = window.YuanDaSupabase.getUserId();
        if (!userId || userId < 0) throw new Error('请先登录');
        if (window.YuanDaSupabase.isOfflineMode && window.YuanDaSupabase.isOfflineMode()) {
            throw new Error('离线模式无法签到');
        }

        const sb = window.YuanDaSupabase.getClient();
        if (!sb) throw new Error('未连接云端');

        const today = fmtDate(new Date());
        const rewards = await loadRewards();

        // 1. 读档案
        const pRes = await sb.from('user_profile')
            .select('signin_streak, signin_best_streak, signin_total_days, last_signin_date, membership')
            .eq('id_number', userId).single();
        if (pRes.error) throw new Error('读取档案失败');

        const p = pRes.data || {};
        const last = p.last_signin_date ? fmtDate(p.last_signin_date) : null;
        if (last === today) {
            return { ok: false, message: '今日已签到，明天再来～', streak: p.signin_streak || 0, total: p.signin_total_days || 0, bonus: 0 };
        }

        // 2. 计算新 streak
        let newStreak = 1;
        if (last) {
            const diff = daysBetween(last, today);
            if (diff === 1) newStreak = (p.signin_streak || 0) + 1;
            // diff > 1 → 中断 → 重置 1
            // diff = 0 → 上面已拦截
        }

        // 3. 计算奖励
        const memberBonus = MEMBER_BONUS[p.membership || 'free'] || 0;
        const streakHit = pickStreakBonus(newStreak, rewards.streak_bonuses || []);
        const bonus = (rewards.daily_base || 10) + memberBonus + (streakHit ? streakHit.bonus : 0);

        // 4. 写签到历史
        const histRes = await sb.from('signin_history').insert({
            id_number: userId,
            signin_date: today,
            streak: newStreak,
            bonus: bonus,
            bonus_type: streakHit ? 'streak' : 'daily',
            is_remedy: false,
            created_at: nowISO(),
        });
        if (histRes.error) {
            // 唯一约束冲突 → 已签到
            if (histRes.error.code === '23505') {
                return { ok: false, message: '今日已签到', streak: p.signin_streak || 0, total: p.signin_total_days || 0, bonus: 0 };
            }
            throw new Error('签到失败：' + histRes.error.message);
        }

        // 5. 更新档案
        const newBest = Math.max(p.signin_best_streak || 0, newStreak);
        const updRes = await sb.from('user_profile').update({
            signin_streak: newStreak,
            signin_best_streak: newBest,
            signin_total_days: (p.signin_total_days || 0) + 1,
            last_signin_date: today,
            last_signin_bonus: bonus,
            updated_at: nowISO(),
        }).eq('id_number', userId);
        if (updRes.error) console.warn('[签到] 更新档案失败', updRes.error);

        // 6. 加积分
        if (bonus > 0) {
            await window.YuanDaSupabase.creditPoints(bonus, 'daily' + (streakHit ? '/streak' : ''),
                `每日签到 +${bonus}（连签 ${newStreak} 天）`);
        }

        const result = { ok: true, bonus, streak: newStreak, total: (p.signin_total_days || 0) + 1, streakHit, message: '' };
        if (streakHit) result.message = `🎉 ${streakHit.label} +${streakHit.bonus} 积分！`;
        else if (newStreak === 7 || newStreak === 14 || newStreak === 30) result.message = `已连签 ${newStreak} 天，下个奖励门槛 ${newStreak + 1} 天`;

        if (typeof _onUpdate === 'function') _onUpdate(result);
        return result;
    }

    // ========== UI 渲染（30 天月历） ==========
    async function render() {
        const body = document.getElementById('signinModalBody');
        if (!body) return;
        const [status, rewards] = await Promise.all([getStatus(), loadRewards()]);

        // 构造 30 天数组（最新在最右）
        const days = [];
        const today = new Date();
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today); d.setDate(d.getDate() - i);
            const ds = fmtDate(d);
            const hit = status.history.find(h => h.signin_date === ds);
            days.push({
                date: ds,
                day: d.getDate(),
                month: d.getMonth() + 1,
                isToday: ds === fmtDate(today),
                signed: !!hit,
                streak: hit ? hit.streak : 0,
                bonus: hit ? hit.bonus : 0,
                isFuture: false,
            });
        }
        // 标记今天
        const todayIdx = days.findIndex(d => d.isToday);
        const canClaimToday = !days[todayIdx].signed;

        // 月份分组
        const groups = [];
        let currentMonth = -1;
        for (const d of days) {
            if (d.month !== currentMonth) {
                groups.push({ month: d.month, days: [] });
                currentMonth = d.month;
            }
            groups[groups.length - 1].days.push(d);
        }

        // 计算下一次连签奖励
        const nextReward = (rewards.streak_bonuses || []).find(r => r.days > status.streak) ||
                           (rewards.streak_bonuses || [])[rewards.streak_bonuses.length - 1];

        const memberBonus = MEMBER_BONUS[status.membership || 'free'] || 0;
        const monthLabel = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

        body.innerHTML = `
            <div class="signin-summary">
                <div class="signin-stat">
                    <div class="signin-stat-num">${status.streak}</div>
                    <div class="signin-stat-label">连续签到</div>
                </div>
                <div class="signin-stat">
                    <div class="signin-stat-num">${status.total}</div>
                    <div class="signin-stat-label">累计天数</div>
                </div>
                <div class="signin-stat">
                    <div class="signin-stat-num">${status.best}</div>
                    <div class="signin-stat-label">最长连签</div>
                </div>
            </div>

            <div class="signin-rule">
                <div>💎 每日基础 <b>${rewards.daily_base}</b> 积分</div>
                <div>👑 会员加成 <b>+${memberBonus}</b>（${status.membership === 'free' ? '升级会员' : '已生效'}）</div>
                <div>🔥 ${(rewards.streak_bonuses || []).map(r => `连签 ${r.days} 天 +${r.bonus}`).join(' / ')}</div>
                ${nextReward ? `<div>🎯 再签 <b>${nextReward.days - status.streak}</b> 天可领 +${nextReward.bonus} 积分</div>` : '<div>🏆 满级达成</div>'}
            </div>

            <button class="signin-claim-btn ${canClaimToday ? '' : 'disabled'}" id="signinClaimBtn" ${canClaimToday ? '' : 'disabled'}>
                ${canClaimToday
                    ? `🎁 签到领 ${(rewards.daily_base || 10) + memberBonus + (pickStreakBonus(status.streak + 1, rewards.streak_bonuses || [])?.bonus || 0)} 积分`
                    : '✅ 今日已签到'}
            </button>

            <div class="signin-calendar">
                ${groups.map(g => `
                    <div class="signin-month-block">
                        <div class="signin-month-title">${g.month}月</div>
                        <div class="signin-days">
                            ${g.days.map(d => `
                                <div class="signin-day ${d.signed ? 'signed' : ''} ${d.isToday ? 'today' : ''}">
                                    <div class="signin-day-num">${d.day}</div>
                                    ${d.signed ? '<div class="signin-day-check">✓</div>' : (d.isToday ? '<div class="signin-day-today-dot"></div>' : '')}
                                    ${d.signed ? '<div class="signin-day-bonus">+' + d.bonus + '</div>' : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        const claimBtn = document.getElementById('signinClaimBtn');
        if (claimBtn && canClaimToday) {
            claimBtn.onclick = async () => {
                claimBtn.disabled = true;
                claimBtn.textContent = '签到中...';
                try {
                    const r = await claim();
                    if (r.ok) {
                        // 刷新积分和会员显示
                        if (typeof window.refreshAllDisplays === 'function') window.refreshAllDisplays();
                        await render();
                        // 弹个 toast
                        showSigninToast(r);
                    } else {
                        claimBtn.textContent = r.message || '签到失败';
                    }
                } catch (e) {
                    claimBtn.textContent = '❌ ' + e.message;
                }
            };
        }
    }

    function showSigninToast(r) {
        const toast = document.createElement('div');
        toast.className = 'signin-toast';
        toast.innerHTML = `
            <div class="signin-toast-title">✅ 签到成功</div>
            <div class="signin-toast-body">连签 <b>${r.streak}</b> 天，获得 <b>+${r.bonus}</b> 积分</div>
            ${r.streakHit ? '<div class="signin-toast-extra">🎉 ' + r.streakHit.label + '</div>' : ''}
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    }

    // ========== 公开 API ==========
    function show() {
        const m = document.getElementById('signinModal');
        if (!m) return;
        m.classList.add('show');
        render();
    }
    function hide() {
        const m = document.getElementById('signinModal');
        if (m) m.classList.remove('show');
    }
    let _onUpdate = null;
    function setOnUpdate(fn) { _onUpdate = fn; }

    window.YuanDaSignin = {
        show, hide, claim, getStatus,
        setOnUpdate,
    };
})();
