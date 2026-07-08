/**
 * 元答 - 支付客户端（纯前端模拟模式，默认）
 *
 * 工作流（模拟模式，开箱即用，无需后端）：
 *   1. 用户选套餐 → choosePayChannel(channel)
 *   2. 本地生成订单号（pending 状态写入 payment_orders 表）
 *   3. 弹出"模拟收银台" modal：展示订单详情、假二维码、倒计时 3 秒
 *   4. 倒计时结束 → 标记订单 paid → 直接调 supabase 给自己加积分 / 开会员
 *   5. 收银台展示"支付成功"页 → 2 秒后自动关闭
 *
 * 如需切换到真实 DaxPay（需先部署后端）：
 *   localStorage.setItem('yuanda_pay_mode', 'daxpay');
 *   重新加载页面
 *
 * 支付模式：
 *   - simulate（默认）：纯前端模拟，整个支付流程在本地闭环
 *   - daxpay：调 daxpay-create-order Edge Function → 跳真实 H5 收银台
 */

(function() {
    'use strict';

    const SUPABASE_URL = 'https://gywocluivxjrcrtxojnj.supabase.co';

    // ========== 套餐配置（金额单位：分） ==========
    const POINTS_PACKAGES = [
        { points: 1000,  price: 990,   label: '约 0.01元/积分', tag: '' },
        { points: 5000,  price: 3990,  label: '约 0.008元/积分', tag: '热门' },
        { points: 10000, price: 6990,  label: '约 0.007元/积分', tag: '推荐' },
        { points: 50000, price: 29900, label: '约 0.006元/积分', tag: '超值' }
    ];

    const MEMBERSHIP_PLANS = [
        {
            id: 'basic', name: '基础会员', monthlyPrice: 1990, yearlyPrice: 19900,
            monthlyPoints: 500, monthlyBonus: 20, modelDiscount: 0.9,
            color: '#06b6d4', badge: 'Cyan',
            features: ['每日签到 +20 积分', '每月赠送 500 积分', '模型调用 9 折', '优先客服支持']
        },
        {
            id: 'pro', name: '专业会员', monthlyPrice: 4900, yearlyPrice: 49000,
            monthlyPoints: 2000, monthlyBonus: 50, modelDiscount: 0.7,
            color: '#6366f1', badge: 'Pro', popular: true,
            features: ['每日签到 +50 积分', '每月赠送 2,000 积分', '模型调用 7 折', '专属模型优先用', '高级客服支持']
        },
        {
            id: 'premium', name: '高级会员', monthlyPrice: 9900, yearlyPrice: 99000,
            monthlyPoints: 5000, monthlyBonus: 100, modelDiscount: 0.5,
            color: '#ec4899', badge: 'Premium',
            features: ['每日签到 +100 积分', '每月赠送 5,000 积分', '模型调用 5 折', '所有模型无限制', 'VIP 专属客服', '新功能抢先体验']
        }
    ];

    // ========== 模式选择 ==========
    function getPayMode() {
        try { return localStorage.getItem('yuanda_pay_mode') || 'simulate'; } catch (e) { return 'simulate'; }
    }
    function setPayMode(mode) {
        try { localStorage.setItem('yuanda_pay_mode', mode); } catch (e) {}
    }

    // ========== 工具函数 ==========
    function genBizOrderNo(prefix) {
        const ts = Date.now().toString(36).toUpperCase();
        const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
        return `${prefix || 'YD'}_${ts}_${rand}`;
    }
    function yuan(cents) { return (cents / 100).toFixed(2); }
    function nowISO() { return new Date().toISOString(); }

    // ========== 业务入账（前端直接调 supabase 给自己加积分/开会员） ==========
    async function grantPoints(userId, points, bizOrderNo, channel) {
        const sb = window.YuanDaSupabase.getClient();
        if (!sb) throw new Error('未连接云端');

        // 读当前账户（行锁由 select for update 在 SQL 端保证；前端只做 CAS：先读再写）
        const getRes = await sb.from('points_account')
            .select('balance, total_earned')
            .eq('id_number', userId).single();
        if (getRes.error || !getRes.data) throw new Error('积分账户不存在');
        const newBalance = (getRes.data.balance || 0) + points;
        const newEarned  = (getRes.data.total_earned || 0) + points;

        // 写积分
        const updRes = await sb.from('points_account').update({
            balance: newBalance,
            total_earned: newEarned,
            updated_at: nowISO(),
        }).eq('id_number', userId);
        if (updRes.error) throw new Error('更新积分失败：' + updRes.error.message);

        // 写流水
        await sb.from('points_transactions').insert({
            id_number: userId,
            amount: points,
            type: 'purchase',
            description: `积分充值 (订单 ${bizOrderNo} · ${channel})`,
            balance_after: newBalance,
            created_at: nowISO(),
        });
        return newBalance;
    }

    async function grantMembership(userId, level, months, bizOrderNo) {
        const sb = window.YuanDaSupabase.getClient();
        if (!sb) throw new Error('未连接云端');
        const getRes = await sb.from('user_profile')
            .select('membership, member_expire_at')
            .eq('id_number', userId).single();
        if (getRes.error || !getRes.data) throw new Error('用户档案不存在');

        // 累加到期时间（未过期则从到期日续；过期则从今天算）
        const base = getRes.data.member_expire_at && new Date(getRes.data.member_expire_at) > new Date()
            ? new Date(getRes.data.member_expire_at)
            : new Date();
        const newExpire = new Date(base);
        newExpire.setMonth(newExpire.getMonth() + months);

        const updRes = await sb.from('user_profile').update({
            membership: level,
            member_expire_at: newExpire.toISOString(),
            member_started_at: getRes.data.membership === level ? getRes.data.member_started_at : nowISO(),
            updated_at: nowISO(),
        }).eq('id_number', userId);
        if (updRes.error) throw new Error('开通会员失败：' + updRes.error.message);
        return newExpire.toISOString();
    }

    // 写订单流水
    async function recordOrder(order) {
        const sb = window.YuanDaSupabase.getClient();
        if (!sb) return;
        try {
            await sb.from('payment_orders').insert({
                biz_order_no: order.bizOrderNo,
                user_id: order.userId,
                biz_type: order.bizType,
                title: order.title,
                amount: order.amount,
                channel: order.channel,
                status: order.status,
                raw_attach: order.extra || {},
                paid_at: order.status === 'paid' ? nowISO() : null,
                created_at: nowISO(),
            });
        } catch (e) { console.warn('[支付] 写订单记录失败', e); }
    }

    // 更新订单状态
    async function updateOrderStatus(bizOrderNo, status, failedReason) {
        const sb = window.YuanDaSupabase.getClient();
        if (!sb) return;
        try {
            await sb.from('payment_orders').update({
                status,
                paid_at: status === 'paid' ? nowISO() : null,
                failed_reason: failedReason || null,
                updated_at: nowISO(),
            }).eq('biz_order_no', bizOrderNo);
        } catch (e) { console.warn('[支付] 更新订单失败', e); }
    }

    // ========== 收银台 modal 控制 ==========
    function showCashierModal(order, onResult) {
        return new Promise((resolve) => {
            const modal = document.getElementById('cashierModal');
            if (!modal) { resolve('fail'); return; }

            // 填充订单信息
            const channelName = order.channel === 'wechat_h5' ? '微信支付' : '支付宝';
            const channelIcon = order.channel === 'wechat_h5' ? '💚' : '💙';
            const channelColor = order.channel === 'wechat_h5' ? '#07c160' : '#1677ff';

            document.getElementById('cashierChannelIcon').textContent = channelIcon;
            document.getElementById('cashierChannelName').textContent = channelName;
            document.getElementById('cashierTitle').textContent = order.title;
            document.getElementById('cashierAmount').textContent = '¥' + yuan(order.amount);
            document.getElementById('cashierOrderNo').textContent = order.bizOrderNo;
            document.getElementById('cashierStatus').textContent = '等待支付...';
            document.getElementById('cashierCountdown').textContent = '3';
            document.getElementById('cashierCountdownWrap').style.display = '';
            document.getElementById('cashierCancelBtn').style.display = '';
            document.getElementById('cashierCloseBtn').style.display = 'none';

            // 假二维码（CSS 画的格子）
            const qr = document.getElementById('cashierQR');
            if (qr) qr.style.borderColor = channelColor;

            // 显示
            modal.classList.add('show');
            modal.dataset.status = 'pending';

            let countdown = 3;
            const timer = setInterval(() => {
                countdown--;
                const cd = document.getElementById('cashierCountdown');
                if (cd) cd.textContent = String(Math.max(0, countdown));
                if (countdown <= 0) {
                    clearInterval(timer);
                    completePayment(order, modal, resolve);
                }
            }, 1000);

            // 取消按钮
            const cancelBtn = document.getElementById('cashierCancelBtn');
            const onCancel = () => {
                clearInterval(timer);
                modal.classList.remove('show');
                modal.dataset.status = 'cancelled';
                updateOrderStatus(order.bizOrderNo, 'closed', '用户取消');
                resolve('cancelled');
            };
            if (cancelBtn) cancelBtn.onclick = onCancel;

            // X 关闭按钮（成功后显示）
            const closeBtn = document.getElementById('cashierCloseBtn');
            if (closeBtn) closeBtn.onclick = () => {
                modal.classList.remove('show');
                resolve(modal.dataset.status || 'paid');
            };
        });
    }

    async function completePayment(order, modal, resolve) {
        document.getElementById('cashierStatus').textContent = '支付处理中...';
        document.getElementById('cashierCountdownWrap').style.display = 'none';

        try {
            // 业务入账
            let extra = '';
            if (order.bizType === 'points') {
                const pts = parseInt(order.extra.points || '0');
                const newBal = await grantPoints(order.userId, pts, order.bizOrderNo, order.channel);
                order.newBalance = newBal;
                extra = `+${pts.toLocaleString()} 积分`;
            } else if (order.bizType === 'membership') {
                const months = parseInt(order.extra.months || '1');
                const newExpire = await grantMembership(order.userId, order.extra.level, months, order.bizOrderNo);
                order.newExpire = newExpire;
                extra = `${order.extra.name} ${months} 个月`;
            }
            await updateOrderStatus(order.bizOrderNo, 'paid');

            // 显示成功页
            document.getElementById('cashierStatus').textContent = '✅ 支付成功';
            document.getElementById('cashierSuccessText').textContent = `${order.title} 已到账（${extra}）`;
            document.getElementById('cashierCancelBtn').style.display = 'none';
            document.getElementById('cashierCloseBtn').style.display = '';
            modal.dataset.status = 'paid';

            // 2 秒后自动关闭
            setTimeout(() => {
                modal.classList.remove('show');
                resolve('paid');
            }, 2500);

            // 触发回调刷新 UI
            if (typeof window.onPaymentSuccess === 'function') {
                window.onPaymentSuccess(order);
            }
        } catch (err) {
            console.error('[支付] 入账失败', err);
            await updateOrderStatus(order.bizOrderNo, 'failed', err.message);
            document.getElementById('cashierStatus').textContent = '❌ 支付失败';
            document.getElementById('cashierSuccessText').textContent = err.message || '入账失败，请稍后重试';
            document.getElementById('cashierCancelBtn').style.display = 'none';
            document.getElementById('cashierCloseBtn').style.display = '';
            modal.dataset.status = 'failed';
        }
    }

    // ========== 发起支付（统一入口） ==========
    async function pay({ bizType, title, amount, channel, extra }) {
        const userId = window.YuanDaSupabase && window.YuanDaSupabase.getUserId();
        if (!userId || userId < 0) throw new Error('请先登录 / 分配用户ID');
        if (window.YuanDaSupabase.isOfflineMode && window.YuanDaSupabase.isOfflineMode()) {
            throw new Error('离线模式无法支付，请先连接云端');
        }

        const order = {
            bizOrderNo: genBizOrderNo(bizType === 'membership' ? 'VIP' : 'CZ'),
            userId,
            bizType,
            title,
            amount,
            channel,
            extra: extra || {},
            status: 'pending',
            createdAt: nowISO(),
        };

        // 写 pending 订单
        await recordOrder(order);

        const mode = getPayMode();
        if (mode === 'daxpay') {
            // 真实 DaxPay 模式：调 Edge Function 拿收银台地址跳转
            const CREATE_ORDER_URL = `${SUPABASE_URL}/functions/v1/daxpay-create-order`;
            const resp = await fetch(CREATE_ORDER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bizOrderNo: order.bizOrderNo,
                    title, amount, channel, bizType, userId, extra: order.extra,
                    returnUrl: location.origin + location.pathname + '?payment-return=' + order.bizOrderNo,
                }),
            });
            const result = await resp.json();
            if (result.code !== 0 || !result.data || !result.data.cashierUrl) {
                throw new Error(result.msg || '未拿到收银台地址');
            }
            // 记 pending 供 returnUrl 回跳识别
            try { sessionStorage.setItem('yuanda_pending_order', JSON.stringify(order)); } catch (e) {}
            window.location.href = result.data.cashierUrl;
            return order;
        }

        // 默认 simulate 模式：弹本地收银台 modal
        return await showCashierModal(order);
    }

    // 便捷封装
    function payPoints(points, priceCents, channel) {
        return pay({
            bizType: 'points',
            title: `充值 ${points.toLocaleString()} 积分`,
            amount: priceCents,
            channel,
            extra: { points },
        });
    }
    function payMembership(planId, months, channel) {
        const plan = MEMBERSHIP_PLANS.find(p => p.id === planId);
        if (!plan) throw new Error('未知会员套餐: ' + planId);
        const m = months || 1;
        return pay({
            bizType: 'membership',
            title: `开通 ${plan.name} (${m} 个月)`,
            amount: plan.monthlyPrice * m,
            channel,
            extra: { level: planId, name: plan.name, months: m, discount: plan.modelDiscount },
        });
    }

    // 公开 API
    window.YuanDaDaxPay = {
        POINTS_PACKAGES,
        MEMBERSHIP_PLANS,
        getPayMode,
        setPayMode,
        pay,
        payPoints,
        payMembership,
        // 兼容老 API
        detectReturnFromCashier: function() {
            const params = new URLSearchParams(location.search);
            const orderNo = params.get('payment-return');
            if (!orderNo) return null;
            let pending = null;
            try { const raw = sessionStorage.getItem('yuanda_pending_order'); if (raw) pending = JSON.parse(raw); } catch (e) {}
            sessionStorage.removeItem('yuanda_pending_order');
            try { history.replaceState({}, '', location.origin + location.pathname); } catch (e) { location.search = ''; }
            return { orderNo, pending };
        },
    };

    console.log('[元答] 支付客户端已加载（模式: ' + getPayMode() + '）');
})();
