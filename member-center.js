/**
 * 元答 - 会员中心 + 顶栏徽章
 *
 * 数据源：user_profile.membership / member_expire_at / member_started_at
 * 套餐数据：YuanDaDaxPay.MEMBERSHIP_PLANS
 *
 * 公开 API：
 *   window.YuanDaMember = {
 *     show(), hide(),                       // 会员中心 modal
 *     refresh(),                            // 刷新当前会员状态（顶栏 / 设置页）
 *     getCurrent(),                         // { level, name, expireAt, isActive, daysLeft }
 *     onUpdate: fn,                         // 状态变化回调
 *   }
 */

(function() {
    'use strict';

    const LEVEL_NAME = {
        free: '免费用户',
        basic: '基础会员',
        pro: '专业会员',
        premium: '高级会员',
        enterprise: '企业会员'
    };
    const LEVEL_COLOR = {
        free: '#94a3b8',
        basic: '#06b6d4',
        pro: '#6366f1',
        premium: '#ec4899',
        enterprise: '#f59e0b'
    };
    const LEVEL_BADGE = {
        free: 'Free',
        basic: 'Cyan',
        pro: 'Pro',
        premium: 'Premium',
        enterprise: 'Enterprise'
    };

    // 内存缓存（refresh() 时从云端拉一次）
    let _cachedProfile = null;

    function getCurrent() {
        const userId = window.YuanDaSupabase.getUserId();
        if (!userId || userId < 0) return { level: 'free', name: '免费用户', expireAt: null, isActive: false, daysLeft: 0, startedAt: null };
        if (!_cachedProfile) return { level: 'free', name: '免费用户', expireAt: null, isActive: false, daysLeft: 0, startedAt: null };
        const lvl = _cachedProfile.membership || 'free';
        const exp = _cachedProfile.member_expire_at ? new Date(_cachedProfile.member_expire_at) : null;
        const isActive = !!(exp && exp > new Date());
        const daysLeft = isActive ? Math.ceil((exp - new Date()) / 86400000) : 0;
        return {
            level: lvl,
            name: LEVEL_NAME[lvl] || lvl,
            color: LEVEL_COLOR[lvl] || '#94a3b8',
            badge: LEVEL_BADGE[lvl] || lvl,
            expireAt: _cachedProfile.member_expire_at,
            startedAt: _cachedProfile.member_started_at,
            isActive,
            daysLeft,
        };
    }

    // 异步从云端拉最新，刷新缓存
    async function refreshFromCloud() {
        const userId = window.YuanDaSupabase.getUserId();
        if (!userId || userId < 0) return null;
        const sb = window.YuanDaSupabase.getClient();
        if (!sb) return null;
        const r = await sb.from('user_profile')
            .select('membership, member_expire_at, member_started_at')
            .eq('id_number', userId).single();
        if (r.error || !r.data) return null;
        _cachedProfile = Object.assign({}, _cachedProfile, r.data);
        return r.data;
    }

    // ========== 顶栏徽章 ==========
    function renderTopBadge() {
        const wrap = document.getElementById('memberTopBadge');
        if (!wrap) return;
        const m = getCurrent();
        if (!m.isActive || m.level === 'free') {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = 'inline-flex';
        wrap.style.background = m.color;
        wrap.innerHTML = `
            <span class="member-top-badge-icon">💎</span>
            <span class="member-top-badge-text">${m.badge}</span>
            <span class="member-top-badge-days">${m.daysLeft}天</span>
        `;
        wrap.title = `${m.name} · 剩余 ${m.daysLeft} 天 · ${m.expireAt ? new Date(m.expireAt).toLocaleDateString() : ''} 到期`;
        wrap.onclick = () => show();
    }

    // ========== 设置页会员卡片 ==========
    function renderSettingCard() {
        const card = document.getElementById('memberSettingCard');
        if (!card) return;
        const m = getCurrent();
        const dot = card.querySelector('.member-status-dot');
        const levelEl = card.querySelector('.member-status-level');
        const detailEl = card.querySelector('.member-status-detail');
        const actionBtn = card.querySelector('.member-action-btn');
        if (dot) dot.style.background = m.color;
        if (levelEl) levelEl.textContent = m.name;
        if (detailEl) {
            if (m.isActive) {
                detailEl.textContent = `${m.daysLeft} 天后到期 · ${m.expireAt ? new Date(m.expireAt).toLocaleDateString() : ''}`;
            } else if (m.level === 'free') {
                detailEl.textContent = '开通会员可享专属特权';
            } else {
                detailEl.textContent = '已过期，立即续费恢复权益';
            }
        }
        if (actionBtn) {
            actionBtn.textContent = m.isActive ? '管理会员' : '开通会员';
            // 用 addEventListener 防止重复绑（每次 refresh 都会调用）
            actionBtn.onclick = (e) => { e.stopPropagation(); show(); };
        }
        // 整卡也可点
        card.onclick = (e) => {
            if (e.target.closest('.member-action-btn')) return; // 按钮已处理
            show();
        };
    }

    // ========== 会员中心 modal 渲染 ==========
    async function renderModal() {
        const body = document.getElementById('memberCenterBody');
        if (!body) return;

        // 拉一次云端最新
        try { await refreshFromCloud(); } catch (e) {}
        const m = getCurrent();
        const plans = window.YuanDaDaxPay.MEMBERSHIP_PLANS;

        body.innerHTML = `
            <div class="member-hero" style="background: linear-gradient(135deg, ${m.color}22, ${m.color}08); border: 1.5px solid ${m.color}33;">
                <div class="member-hero-left">
                    <div class="member-hero-level">${m.name}</div>
                    ${m.isActive
                        ? `<div class="member-hero-expire">到期时间：${m.expireAt ? new Date(m.expireAt).toLocaleDateString() : '-'}</div>
                           <div class="member-hero-expire">剩余 <b style="color:${m.color}">${m.daysLeft}</b> 天</div>`
                        : (m.level === 'free'
                            ? '<div class="member-hero-expire">开通会员，畅享专属特权</div>'
                            : '<div class="member-hero-expire" style="color:#ef4444">已过期，立即续费恢复</div>')}
                </div>
                <div class="member-hero-right">
                    <div class="member-hero-badge" style="background:${m.color}">${m.badge}</div>
                </div>
            </div>

            ${m.isActive ? `
            <div class="member-actions">
                <button class="member-action-secondary" onclick="window.YuanDaDaxPay.payMembership('${m.level}', 1)">续费 1 个月</button>
                <button class="member-action-secondary" onclick="window.YuanDaDaxPay.payMembership('${m.level}', 12)">续费 12 个月（省 2 个月）</button>
            </div>` : ''}

            <div class="member-plans-title">📦 套餐对比</div>
            <div class="member-plans">
                ${plans.map(p => {
                    const isCurrent = p.id === m.level && m.isActive;
                    return `
                    <div class="member-plan ${isCurrent ? 'current' : ''} ${p.popular ? 'popular' : ''}" style="border-color: ${p.color}40">
                        ${p.popular ? '<div class="member-plan-popular" style="background:' + p.color + '">推荐</div>' : ''}
                        ${isCurrent ? '<div class="member-plan-current" style="background:' + p.color + '">当前</div>' : ''}
                        <div class="member-plan-name" style="color:${p.color}">${p.name}</div>
                        <div class="member-plan-price">
                            <span class="member-plan-price-num">¥${(p.monthlyPrice / 100).toFixed(0)}</span>
                            <span class="member-plan-price-unit">/月</span>
                        </div>
                        <div class="member-plan-yearly">年付 ¥${(p.yearlyPrice / 100).toFixed(0)}（省 2 个月）</div>
                        <ul class="member-plan-features">
                            ${p.features.map(f => '<li>' + f + '</li>').join('')}
                        </ul>
                        <button class="member-plan-buy" style="background:${p.color}" onclick="window.YuanDaDaxPay.payMembership('${p.id}', 1)">
                            ${isCurrent ? '续费' : '立即开通'}
                        </button>
                    </div>
                    `;
                }).join('')}
            </div>

            <div class="member-history-title">📜 最近订单</div>
            <div id="memberOrderHistory"><div class="member-history-loading">加载中...</div></div>
        `;

        // 拉最近订单
        try {
            const userId = window.YuanDaSupabase.getUserId();
            const sb = window.YuanDaSupabase.getClient();
            if (userId && sb) {
                const r = await sb.from('payment_orders')
                    .select('biz_order_no, title, amount, channel, status, paid_at, created_at')
                    .eq('user_id', userId)
                    .eq('biz_type', 'membership')
                    .order('created_at', { ascending: false })
                    .limit(10);
                const hist = document.getElementById('memberOrderHistory');
                if (hist) {
                    if (r.error || !r.data || r.data.length === 0) {
                        hist.innerHTML = '<div class="member-history-empty">暂无订单</div>';
                    } else {
                        hist.innerHTML = r.data.map(o => `
                            <div class="member-history-row">
                                <div class="member-history-left">
                                    <div class="member-history-title-text">${o.title || '-'}</div>
                                    <div class="member-history-date">${new Date(o.created_at).toLocaleString()}</div>
                                </div>
                                <div class="member-history-right">
                                    <div class="member-history-amount">¥${(o.amount / 100).toFixed(2)}</div>
                                    <div class="member-history-status status-${o.status}">${statusText(o.status)}</div>
                                </div>
                            </div>
                        `).join('');
                    }
                }
            }
        } catch (e) { console.warn('[会员中心] 订单历史加载失败', e); }
    }

    function statusText(s) {
        return { paid: '已支付', pending: '待支付', failed: '失败', closed: '已取消', refunded: '已退款' }[s] || s;
    }

    // ========== 公开 API ==========
    function show() {
        const m = document.getElementById('memberCenterModal');
        if (m) m.classList.add('show');
        renderModal();
    }
    function hide() {
        const m = document.getElementById('memberCenterModal');
        if (m) m.classList.remove('show');
    }
    function refresh() {
        renderTopBadge();
        renderSettingCard();
        if (typeof _onUpdate === 'function') _onUpdate(getCurrent());
    }

    let _onUpdate = null;
    function setOnUpdate(fn) { _onUpdate = fn; }

    // 暴露
    window.YuanDaMember = {
        show, hide, refresh, getCurrent,
        setOnUpdate,
        LEVEL_NAME, LEVEL_COLOR, LEVEL_BADGE,
    };

    // 暴露全局刷新函数（供支付成功 / 签到成功后调用）
    window.refreshAllDisplays = function() {
        if (typeof window.YuanDaSupabase.getPointsBalance === 'function') {
            window.YuanDaSupabase.getPointsBalance().then(bal => {
                const el = document.getElementById('userPointsDisplay');
                if (el) el.textContent = String(bal);
            }).catch(() => {});
        }
        try { window.YuanDaMember && window.YuanDaMember.refresh(); } catch (e) {}
    };

    // 支付成功回调
    window.onPaymentSuccess = function(order) {
        setTimeout(() => {
            window.refreshAllDisplays();
            if (window.addMessage) {
                const tip = order.bizType === 'membership'
                    ? '💎 会员已开通，' + (order.extra.months || 1) + ' 个月有效期'
                    : '💰 积分已到账：+' + (order.extra.points || 0) + ' 积分';
                window.addMessage('system', tip);
            }
        }, 100);
    };
})();
