/**
 * 元答 - 积分扣费系统
 * 按 Token 实际用量扣费，价格与各模型官方 API 定价一致
 * 1 积分 = ¥0.001（1厘）
 * 参考定价来源：各模型厂商官方定价页（2026年6月）
 *   - DeepSeek: api-docs.deepseek.com
 *   - 智谱 GLM: open.bigmodel.cn/pricing
 *   - 阿里云百炼 Qwen: help.aliyun.com/zh/model-studio/model-pricing
 *   - Moonshot Kimi: platform.kimi.ai/docs/pricing
 */

// ========== 模型 Token 定价配置 ==========
// 单位：积分/1K tokens（1 积分 = ¥0.001）
// 价格数据来自各模型官方 API 定价（¥/百万 tokens），÷1000 即得 积分/1K
const MODEL_PRICING = {
    // 阿里云百炼 DashScope 官方定价
    qwen: {
        name: '千问系列',
        inputPrice: 1.5,     // Qwen3.5-27B ¥1.41/M ≈ 1.5 积分/1K
        outputPrice: 6.5,    // Qwen3.5-27B ¥6.53/M ≈ 6.5 积分/1K
        note: '阿里云百炼 Qwen3.5-27B'
    },
    // DeepSeek 官方定价
    deepseek: {
        name: 'DeepSeek系列',
        inputPrice: 1.5,     // DeepSeek-V3.2 $0.229/M ≈ ¥1.60/M ≈ 1.5 积分/1K
        outputPrice: 2.5,    // DeepSeek-V3.2 $0.343/M ≈ ¥2.40/M ≈ 2.5 积分/1K
        note: 'DeepSeek V3.2'
    },
    // 智谱 GLM 官方定价
    glm: {
        name: 'GLM系列',
        inputPrice: 4.5,     // GLM-4.7 ¥4.3/M + GLM-5 ¥7.2/M 平均 ≈ 4.5 积分/1K
        outputPrice: 15.5,   // GLM-4.7 ¥15.8/M + GLM-5 ¥23.0/M 平均 ≈ 15.5 积分/1K
        note: '智谱 GLM-4.7 / GLM-5'
    },
    // Moonshot Kimi 官方定价
    kimi: {
        name: 'Kimi系列',
        inputPrice: 2.5,     // Kimi K2.5 $0.38/M ≈ ¥2.66/M ≈ 2.5 积分/1K
        outputPrice: 14,     // Kimi K2.5 $2.02/M ≈ ¥14.14/M ≈ 14 积分/1K
        note: 'Moonshot Kimi K2.5'
    },
    // 油价查询免费
    oil: {
        name: '油价查询',
        fixedCost: 0,
        note: '油价查询免费'
    }
};

// ========== 特定模型的价格覆盖 ==========
// key: modelId -> 覆盖 series 级别定价
const MODEL_PRICING_OVERRIDES = {
    21: {  // DeepSeek-R1-Distill-Llama-70B
        inputPrice: 5.5,
        outputPrice: 5.5,
        note: 'DeepSeek R1-DL-70B'
    },
    22: {  // DeepSeek-V4-Flash
        inputPrice: 0.5,
        outputPrice: 1.5,
        note: 'DeepSeek V4 Flash'
    },
    23: {  // DeepSeek-V4-Pro
        inputPrice: 3,
        outputPrice: 6,
        note: 'DeepSeek V4 Pro'
    },
    31: {  // GLM-5（旗舰）
        inputPrice: 7,
        outputPrice: 23,
        note: '智谱 GLM-5'
    },
    32: {  // GLM-4.7-Flash（免费）
        inputPrice: 0,
        outputPrice: 0,
        note: '智谱 GLM-4.7 Flash（免费）'
    },
    33: {  // GLM-5.2（旗舰）
        inputPrice: 8,
        outputPrice: 25,
        note: '智谱 GLM-5.2'
    }
};

// ========== 会员折扣配置 ==========
const MEMBERSHIP_DISCOUNT = {
    free: 1.0,
    premium: 0.9,    // 9折
    pro: 0.7,        // 7折
    enterprise: 0.5  // 5折
};

// ========== 获取模型定价（支持模型级覆盖） ==========
function getModelPricing(modelSeries, modelId) {
    // 优先使用模型级定价覆盖
    if (modelId && MODEL_PRICING_OVERRIDES[modelId]) {
        return MODEL_PRICING_OVERRIDES[modelId];
    }
    // 回退到系列级定价
    return MODEL_PRICING[modelSeries] || null;
}

// ========== 估算 Token 数量 ==========
function estimateTokens(text) {
    if (!text) return 0;
    let chineseChars = 0;
    let englishChars = 0;
    let otherChars = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0x4e00 && code <= 0x9fff) {
            chineseChars++;
        } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
            englishChars++;
        } else {
            otherChars++;
        }
    }
    const totalEstimated = chineseChars * 0.67 + englishChars * 0.25 + otherChars * 0.3;
    return Math.max(1, Math.round(totalEstimated));
}

// ========== 计算输入 Token 总数 ==========
function estimateInputTokens(messages) {
    let total = 0;
    messages.forEach(msg => {
        total += estimateTokens(msg.content);
    });
    return total + 20; // 固定格式开销
}

// ========== 计算本次调用的预估费用（含低/高范围） ==========
// 返回：{ estimatedCost, minCost, maxCost, inputTokens, estimatedOutputTokens }
function estimateCallCost(modelSeries, messages, options = {}) {
    const modelId = options.modelId;
    const pricing = getModelPricing(modelSeries, modelId);
    if (!pricing) return { estimatedCost: 1, minCost: 1, maxCost: 2, inputTokens: 100, estimatedOutputTokens: 50 };
    if (pricing.fixedCost !== undefined) return { estimatedCost: pricing.fixedCost, minCost: pricing.fixedCost, maxCost: pricing.fixedCost, inputTokens: 0, estimatedOutputTokens: 0 };

    const inputTokens = estimateInputTokens(messages);
    // 输出token范围：输入的30%~150%
    function calcRaw(ratio) {
        const estOut = Math.round(inputTokens * ratio);
        let cost = inputTokens * pricing.inputPrice / 1000 + estOut * pricing.outputPrice / 1000;
        // 会员折扣
        const membership = (options.membership || 'free');
        const discount = MEMBERSHIP_DISCOUNT[membership] || 1.0;
        cost = cost * discount;
        return Math.max(1, Math.round(cost));
    }

    const minCost = calcRaw(0.3);
    const maxCost = calcRaw(1.5);
    const estimatedCost = Math.round((minCost + maxCost) / 2);

    return {
        estimatedCost,
        minCost,
        maxCost,
        inputTokens,
        estimatedOutputTokens: Math.round(inputTokens * 1.0),
        pricing
    };
}

// ========== 根据实际 Token 用量计算最终费用 ==========
function calculateFinalCost(modelSeries, inputTokens, outputTokens, options = {}) {
    const modelId = options.modelId;
    const pricing = getModelPricing(modelSeries, modelId);
    if (!pricing) return { finalCost: 1, inputTokens, outputTokens };
    if (pricing.fixedCost !== undefined) return { finalCost: pricing.fixedCost, inputTokens: 0, outputTokens: 0 };

    // 官方定价计算：积分/1K tokens
    let finalCost = (inputTokens || 0) * pricing.inputPrice / 1000 + (outputTokens || 0) * pricing.outputPrice / 1000;

    // 会员折扣
    const membership = (options.membership || 'free');
    const discount = MEMBERSHIP_DISCOUNT[membership] || 1.0;
    finalCost = Math.round(finalCost * discount);

    return {
        finalCost: Math.max(1, finalCost),
        inputTokens: inputTokens || 0,
        outputTokens: outputTokens || 0,
        inputCost: Math.round((inputTokens || 0) * pricing.inputPrice / 1000),
        outputCost: Math.round((outputTokens || 0) * pricing.outputPrice / 1000),
        membershipDiscount: discount,
        breakdown: `输入${inputTokens || 0}·输出${outputTokens || 0} tokens` + (discount < 1 ? ` (${Math.round(discount*10)}折)` : ''),
        pricingNote: pricing.note || ''
    };
}

// ========== 提取 Token 用量 ==========
function extractTokenUsage(data) {
    if (data && data.usage) {
        return {
            inputTokens: data.usage.prompt_tokens || 0,
            outputTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
            found: true
        };
    }
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, found: false };
}

// ========== 获取用户会员等级 ==========
async function getUserMembership() {
    try {
        const profile = await YuanDaSupabase.getProfile();
        return profile && profile.membership ? profile.membership : 'free';
    } catch (e) {
        return 'free';
    }
}

// ========== 执行扣费 ==========
async function deductByTokenUsage(modelSeries, inputTokens, outputTokens, modelName, options = {}) {
    const membership = options.membership || await getUserMembership();
    const calc = calculateFinalCost(modelSeries, inputTokens, outputTokens, { ...options, membership });
    const cost = calc.finalCost;

    if (cost <= 0) {
        // 免费模型：从 supabase 客户端拿当前余额（避免引用未定义的 userPoints）
        let bal = 0;
        try { bal = await YuanDaSupabase.getPointsBalance(); } catch (e) {}
        return { success: true, balance: bal, cost: 0 };
    }

    const result = await YuanDaSupabase.deductPoints(cost, modelName, `调用模型: ${modelName} (${calc.breakdown})`);
    return {
        success: result.success,
        balance: result.balance,
        cost: cost,
        message: result.message,
        breakdown: calc.breakdown
    };
}

// ========== 导出给全局使用 ==========
window.YuanDaBilling = {
    MODEL_PRICING,
    MODEL_PRICING_OVERRIDES,
    MEMBERSHIP_DISCOUNT,
    getModelPricing,
    estimateTokens,
    estimateInputTokens,
    estimateCallCost,
    calculateFinalCost,
    extractTokenUsage,
    deductByTokenUsage,
    getUserMembership
};
