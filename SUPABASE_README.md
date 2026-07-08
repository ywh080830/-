# 元答 Supabase 集成说明

## 已实现功能

### 1. 自动更新
- `checkAppUpdate()` - 从 Supabase `app_config` 表读取最新版本信息
- 支持强制更新标志、更新日志、下载地址
- 设置页面"检查更新"按钮已接入

### 2. 数据存储
- 会话历史、设置、收藏、统计信息自动同步到 Supabase `user_storage` 表
- 防抖保存 (2秒间隔)，避免频繁写入
- "备份到云端"按钮手动触发全量备份
- 进入应用时自动从云端恢复数据

### 3. ID池系统
- Supabase 预填充 10000 个ID (10001~20000)
- 用户进入应用时自动从池中分配一个ID
- ID绑定独立的存储空间 (会话/设置/收藏/积分/个人中心)
- 注销时调用 `recycle_user_id` 存储过程，清空所有数据，ID回收到池中
- 下次进入分配新ID

### 4. 积分系统
- 新用户注册赠送 1000 积分
- 每个模型调用按定价扣费:
  - Qwen: 1积分/次
  - DeepSeek: 2积分/次
  - GLM: 3积分/次
  - Kimi: 2积分/次
  - 基金查询/油价查询: 免费
- 每日签到领取 100 积分
- 积分不足时阻止调用模型并提示
- 完整的交易记录查询

### 5. 个人中心
- 显示用户ID和积分余额
- 每次对话自动更新模型使用统计
- 支持注销账号 (清空所有数据)

## 数据库表结构

| 表名 | 用途 |
|------|------|
| `id_pool` | ID池 (10001~20000) |
| `user_storage` | 用户数据存储 (会话/设置/收藏/统计) |
| `points_account` | 积分账户 (余额/累计获得/累计消费) |
| `points_transactions` | 积分交易记录 |
| `user_profile` | 个人中心信息 (昵称/头像/模型统计) |
| `app_config` | APP配置 (版本号/模型定价/签到奖励) |
| `visits` | 访问统计 (原有功能) |

## 部署步骤

### 第一步: 执行SQL
1. 登录 Supabase 控制台: https://supabase.com/dashboard
2. 进入项目 `gywocluivxjrcrtxojnj`
3. 打开 SQL Editor
4. 复制 `assets/supabase_setup.sql` 全部内容
5. 执行 SQL (会创建所有表、策略、触发器、存储过程)

### 第二步: 部署前端文件
确保以下文件在 APK 的 assets 目录中:
- `assets/index.html` (已更新)
- `assets/supabase-client.js` (新增)
- `assets/supabase_setup.sql` (已更新，供参考)

### 第三步: 验证
1. 打开应用，检查控制台是否输出 `[元答] 分配新ID: xxxxx`
2. 进入设置页面，查看"个人中心"区域是否显示ID和积分
3. 发送消息，观察积分是否扣减
4. 点击"每日签到"测试签到功能
5. 点击"注销"测试ID回收

## 管理操作

### 修改模型定价
在 Supabase SQL Editor 执行:
```sql
UPDATE app_config 
SET config_value = '{"qwen": 2, "deepseek": 3, "glm": 5, "kimi": 3, "fund": 0, "oil": 0}'::jsonb
WHERE config_key = 'model_pricing';
```

### 修改每日签到奖励
```sql
UPDATE app_config 
SET config_value = '{"amount": 200, "enabled": true}'::jsonb
WHERE config_key = 'daily_bonus';
```

### 发布新版本
```sql
UPDATE app_config 
SET config_value = '{"version": "1.1.0", "code": 101, "update_url": "https://example.com/download", "force_update": false, "changelog": "1. 新增XX功能\n2. 修复XX问题"}'::jsonb
WHERE config_key = 'app_version';
```

### 查看用户数据
```sql
-- 查看所有用户ID状态
SELECT status, COUNT(*) FROM id_pool GROUP BY status;

-- 查看活跃用户
SELECT * FROM user_profile ORDER BY last_active_at DESC LIMIT 20;

-- 查看积分消耗排行
SELECT * FROM points_account ORDER BY total_spent DESC LIMIT 20;
```
