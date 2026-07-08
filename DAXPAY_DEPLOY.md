# 元答 · DaxPay 支付系统接入与部署文档

本项目已为「元答」集成 **DaxPay Open** 支付网关（开源版）+ **纯前端模拟模式**（默认），支持**积分充值**和**会员订阅**两个业务场景，接入**微信 H5** 与**支付宝 H5** 两种支付渠道。

## 两种支付模式

### 模式 A：纯前端模拟（默认，开箱即用）

无需部署任何后端，支付流程在 APP 内闭环：

```
用户选套餐 → 弹假收银台 modal（订单详情+假二维码+3秒倒计时）→ 自动入账 → 关闭
```

**适用场景**：
- 内测、演示、产品原型
- 不想承担真实支付合规成本
- 内部测试充值 / 会员流程

**启用方式**：`localStorage.setItem('yuanda_pay_mode', 'simulate')`（默认值）

### 模式 B：真实 DaxPay（需部署后端）

```
APP → Supabase Edge Function (签名代理) → DaxPay 网关 (Java后端) → 微信/支付宝
```

**适用场景**：
- 正式上线
- 需要真实资金流
- 已有 / 愿意申请微信商户号 + 支付宝商家

**启用方式**：
```js
localStorage.setItem('yuanda_pay_mode', 'daxpay');
location.reload();
```

**两种模式可随时切换**，不影响本地未支付订单。

---

## 整体架构（真实 DaxPay 模式）

```
┌──────────┐      ┌─────────────────────┐      ┌────────────┐      ┌──────────┐
│  元答 APP │ ──→ │ Supabase Edge Func  │ ──→ │ DaxPay 网关 │ ──→ │ 微信/支付│
│  (H5)     │ ←── │ (daxpay-create-order)│ ←── │ (Java后端) │ ←── │   宝     │
└──────────┘      └─────────────────────┘      └─────┬──────┘      └──────────┘
                                                    │
                                                    │ 异步通知（验签+入账）
                                                    ▼
                                             ┌──────────────────┐
                                             │ daxpay-notify    │
                                             │ Edge Function    │
                                             └──────────────────┘
```

**为什么用 Supabase Edge Function 做签名代理？**
- DaxPay 的 `signKey` 绝不能放在前端（会被反编译盗用）
- Supabase Edge Function 是私密后端，可安全存放密钥
- 通知回调也在 Edge Function 验签后入账，链路安全

---

## 目录

- [一、纯前端模拟模式（默认，无需后端）](#一纯前端模拟模式默认无需后端)
- [二、真实 DaxPay 后端部署（Java 网关）](#二真实-daxpay-后端部署java-网关)
- [三、申请商户号（微信 / 支付宝）](#三申请商户号微信--支付宝)
- [四、在 DaxPay 管理端配置商户信息](#四在-daxpay-管理端配置商户信息)
- [五、执行数据库 SQL（创建支付订单表 + 签到表）](#五执行数据库-sql创建支付订单表--签到表)
- [六、部署 Supabase Edge Function](#六部署-supabase-edge-function)
- [七、配置 Supabase 环境变量（密钥）](#七配置-supabase-环境变量密钥)
- [八、部署前端资源](#八部署前端资源)
- [九、联调测试](#九联调测试)
- [十、常见问题 FAQ](#十常见问题-faq)
- [十一、文件清单](#十一文件清单)

---

## 一、纯前端模拟模式（默认，无需后端）

### 1.1 工作流程

```
┌──────────┐                                    ┌──────────┐
│  元答 APP │  →  弹模拟收银台 modal  →  3s后自动入账  →  Supabase
│  (H5)     │    (订单详情+假二维码+倒计时)            │  (积分+会员)
└──────────┘                                    └──────────┘
```

### 1.2 文件清单（纯前端模式只需这些文件）

| 文件 | 作用 |
|------|------|
| `assets/daxpay.js` | 支付客户端（模拟收银台 + 真实 DaxPay 切换） |
| `assets/signin.js` | 30天月历签到 |
| `assets/member-center.js` | 会员中心 + 顶栏徽章 + 设置页卡片 |
| `assets/supabase-inline.js` | 增 `creditPoints` 工具 |
| `assets/daxpay_setup.sql` | 支付订单表 + 签到表（必须执行） |
| `assets/index.html` | 4 个新 modal + 顶栏徽章 + 会员卡片 |

### 1.3 数据库准备

在 Supabase SQL Editor 中执行：
1. [`assets/supabase_setup.sql`](./assets/supabase_setup.sql)（基础 schema）
2. [`assets/daxpay_setup.sql`](./assets/daxpay_setup.sql)（支付 + 签到扩展）

### 1.4 切换到真实 DaxPay

部署完成后（见下文），在前端控制台：
```js
localStorage.setItem('yuanda_pay_mode', 'daxpay');
location.reload();
```

回到模拟模式：
```js
localStorage.setItem('yuanda_pay_mode', 'simulate');
location.reload();
```

---

## 二、真实 DaxPay 后端部署（Java 网关）

仅在需要真实支付时执行此节。

DaxPay 官方仓库（开源版）：<https://gitee.com/dromara/dax-pay>

### 1.1 准备服务器
- 2C4G 起步，公网 IP，能访问微信/支付宝开放平台
- 域名（必须 HTTPS），用于接收回调和 H5 收银台

### 1.2 Docker Compose 一键部署

新建 `/opt/daxpay/docker-compose.yml`：

```yaml
version: '3.8'
services:
  daxpay:
    image: registry.cn-hangzhou.aliyuncs.com/dromara/daxpay:latest
    container_name: daxpay
    restart: always
    ports:
      - "9999:9999"
    volumes:
      - ./logs:/logs
    environment:
      # 数据库（生产环境强烈建议独立部署的 MySQL）
      - SPRING_DATASOURCE_URL=jdbc:mysql://mysql:3306/daxpay?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
      - SPRING_DATASOURCE_USERNAME=daxpay
      - SPRING_DATASOURCE_PASSWORD=YourStrongPassword
      # 签名密钥（元答侧需要用同样的值）
      - DAXPAY_SECURITY_SIGN_SECRET=YourDaxPaySignSecret
      # 管理端密码
      - DAXPAY_ADMIN_PASSWORD=YourAdminPassword
      # Redis（用于回调幂等）
      - SPRING_REDIS_HOST=redis
      - SPRING_REDIS_PORT=6379
    depends_on:
      - mysql
      - redis

  mysql:
    image: mysql:8.0
    container_name: daxpay-mysql
    restart: always
    environment:
      - MYSQL_ROOT_PASSWORD=rootpw
      - MYSQL_DATABASE=daxpay
      - MYSQL_USER=daxpay
      - MYSQL_PASSWORD=YourStrongPassword
    volumes:
      - ./mysql:/var/lib/mysql
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci

  redis:
    image: redis:7-alpine
    container_name: daxpay-redis
    restart: always
    volumes:
      - ./redis:/data

  nginx:
    image: nginx:alpine
    container_name: daxpay-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - daxpay
```

新建 `./nginx.conf`（关键片段）：

```nginx
events { worker_connections 1024; }
http {
    server {
        listen 443 ssl;
        server_name pay.yourdomain.com;
        ssl_certificate     /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;

        location / {
            proxy_pass         http://daxpay:9999;
            proxy_set_header   Host              $host;
            proxy_set_header   X-Real-IP         $remote_addr;
            proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto $scheme;
            proxy_read_timeout 60s;
        }
    }
}
```

启动：

```bash
cd /opt/daxpay
mkdir certs && cp /path/to/{fullchain.pem,privkey.pem} certs/
docker compose up -d
docker compose logs -f daxpay   # 观察启动日志
```

### 1.3 验证部署
浏览器访问 `https://pay.yourdomain.com`，应看到 DaxPay 管理端登录页。
默认账号 `admin` / 密码 `YourAdminPassword`（首次登录会要求改密）。

---

## 二、申请商户号（微信 / 支付宝）

### 2.1 微信支付（H5）
1. 注册**微信支付商户号**：<https://pay.weixin.qq.com>
2. 申请 **H5 支付** 产品
3. 在「商户平台 → 产品中心 → H5支付」中配置**授权域名**（即 `pay.yourdomain.com`）
4. 记录：`AppID`、`AppSecret`、`商户号 (MchId)`、`API 密钥 v3 (APIv3 Key)`

### 2.2 支付宝（H5 / 手机网站支付）
1. 注册**支付宝商家**：<https://b.alipay.com>
2. 申请「手机网站支付」产品
3. 创建应用 → 获得 **APPID**
4. 配置密钥：推荐用「公钥证书模式」更安全
5. 记录：`APPID`、`应用私钥 (APP_PRIVATE_KEY)`、`支付宝公钥 (ALIPAY_PUBLIC_KEY)`

---

## 三、在 DaxPay 管理端配置商户信息

登录 `https://pay.yourdomain.com`，完成以下配置：

### 3.1 创建商户应用
「系统管理 → 商户管理 → 新增」：
- 商户号：内部编号（自定义）
- 商户名称：「元答」
- 启用签名：**开启**（必填）
- 签名密钥：生成一个随机字符串，例如 `YD_3xK9pQzL7m2R8vN5wT`（**这个值就是 `DAXPAY_SIGN_KEY` 环境变量**）

### 3.2 配置微信支付通道
「支付通道 → 微信 → 新增」：
- AppID：填 §2.1 的 AppID
- 商户号：填 §2.1 的 MchId
- APIv3 密钥：填 §2.1 的 APIv3 Key
- AppSecret：填 §2.1 的 AppSecret
- 启用 H5 支付：**勾选**

### 3.3 配置支付宝支付通道
「支付通道 → 支付宝 → 新增」：
- APPID：填 §2.2 的 APPID
- 应用私钥：填 §2.2 的 APP_PRIVATE_KEY
- 支付宝公钥：填 §2.2 的 ALIPAY_PUBLIC_KEY
- 启用手机网站支付：**勾选**

### 3.4 配置回调地址（可选）
「系统管理 → 系统配置」：
- 默认通知地址：`https://<your-supabase-project>.supabase.co/functions/v1/daxpay-notify`

> ⚠️ 通知地址以**环境变量 `DAXPAY_NOTIFY_URL`** 为准（更灵活），管理端可只做参考。

---

## 四、执行数据库 SQL（创建支付订单表）

在 Supabase Dashboard → SQL Editor，依次执行：

1. 先执行现有的 [`assets/supabase_setup.sql`](./assets/supabase_setup.sql)（如果之前没跑过）
2. 再执行 [`assets/daxpay_setup.sql`](./assets/daxpay_setup.sql)

`daxpay_setup.sql` 会做 4 件事：
- 给 `user_profile` 加 `membership` / `member_expire_at` 字段
- 放宽 `points_transactions.type` 约束（兼容 'purchase' / 'bonus' / 'monthly'）
- 新建 `payment_orders` 表（订单流水）
- 写入 `app_config` 中的 `membership_plans` / `points_packages` 配置

执行完毕应看到：
```
✅ DaxPay 数据库扩展部署完成
   - user_profile 已增加 membership / member_expire_at 字段
   - points_transactions.type 约束已扩展（兼容 purchase/bonus/monthly）
   - payment_orders 表已创建
   - app_config 中已写入 membership_plans / points_packages
```

---

## 五、部署两个 Supabase Edge Function

确保本机已装 [Supabase CLI](https://supabase.com/docs/guides/cli)：

```bash
# 登录
npx supabase login

# 关联项目
npx supabase link --project-ref gywocluivxjrcrtxojnj
```

部署两个函数：

```bash
# 创建订单（前端调用，不需要鉴权）
npx supabase functions deploy daxpay-create-order --no-verify-jwt

# 异步通知（DaxPay 调用，不需要鉴权）
npx supabase functions deploy daxpay-notify --no-verify-jwt
```

部署成功后会得到：
- `https://gywocluivxjrcrtxojnj.supabase.co/functions/v1/daxpay-create-order`
- `https://gywocluivxjrcrtxojnj.supabase.co/functions/v1/daxpay-notify`

---

## 六、配置 Supabase 环境变量（密钥）

复制 [`.env.daxpay.example`](./.env.daxpay.example) 为 `.env`，填入实际值，然后：

```bash
# 方式一：逐个注入
npx supabase secrets set DAXPAY_GATEWAY_URL=https://pay.yourdomain.com
npx supabase secrets set DAXPAY_APP_ID=your_app_id
npx supabase secrets set DAXPAY_SIGN_KEY=YD_3xK9pQzL7m2R8vN5wT
npx supabase secrets set DAXPAY_NOTIFY_URL=https://gywocluivxjrcrtxojnj.supabase.co/functions/v1/daxpay-notify
npx supabase secrets set SUPABASE_URL=https://gywocluivxjrcrtxojnj.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# 方式二：批量
npx supabase secrets set --env-file .env
```

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` 是超级权限，**绝对不能泄漏到前端**。  
> 改完密钥后建议重新部署一次函数让环境变量生效：
> ```bash
> npx supabase functions deploy daxpay-create-order --no-verify-jwt
> npx supabase functions deploy daxpay-notify --no-verify-jwt
> ```

---

## 七、部署前端资源

需要把以下文件打入 `assets/` 目录（与 `supabase.min.js` 同级）：

| 文件 | 作用 |
|------|------|
| `assets/daxpay.js` | DaxPay 前端客户端（新增） |
| `assets/daxpay_setup.sql` | 数据库扩展脚本（新增） |
| `assets/index.html` | 已更新：引入 daxpay.js、加会员/充值入口、替换演示代码 |

如果你用 HBuilderX 打包 APK，**重新生成安装包**即可；
如果你直接通过 `assets/unpackage/.../www/index.html` 调试，可单独替换那 3 个文件。

---

## 八、联调测试

### 8.1 冒烟测试 Edge Function

```bash
# 测试创建订单
curl -X POST https://gywocluivxjrcrtxojnj.supabase.co/functions/v1/daxpay-create-order \
  -H "Content-Type: application/json" \
  -d '{
    "bizOrderNo": "TEST_001",
    "title": "测试充值1000积分",
    "amount": 100,
    "channel": "wechat_h5",
    "bizType": "points",
    "userId": 10001,
    "extra": {"points": 1000}
  }'
```

正常应返回：
```json
{"code":0,"data":{"cashierUrl":"https://pay.yourdomain.com/cashier/xxx","orderNo":"...","bizOrderNo":"TEST_001"}}
```

### 8.2 在 APP 里走完整流程

1. 打开「元答」APP，进入「设置 → 个人中心」
2. 点击「充值 / 开通会员 → 前往」
3. 选择「积分加量包 → 立即购买」（建议用最小金额 ¥9.9）
4. 弹出「选择支付方式」→ 选「支付宝」（推荐先测）
5. 页面跳转到 DaxPay H5 收银台 → 用**支付宝沙箱账号**扫码
6. 支付成功 → 收银台跳回 APP（`index.html?payment-return=xxx`）
7. APP 内弹「🎉 支付完成！积分已到账」提示
8. 「设置 → 个人中心」积分余额应已增加

### 8.3 验证异步通知

- 微信/支付宝扫码支付后，登录 Supabase Dashboard → Edge Functions → daxpay-notify → Logs
- 应看到 `[daxpay-notify] 处理成功: <订单号>` 日志
- 查 `payment_orders` 表：对应订单 `status` 应为 `paid`
- 查 `points_account` 表：用户 `balance` 应已增加

### 8.4 用微信沙箱测

微信 H5 沙箱需要「沙箱公众号」，比较麻烦。**优先用支付宝沙箱跑通**，再接微信：

- 支付宝沙箱 APP：<https://opendocs.alipay.com/common/02kkv7>
- 登录沙箱账号，沙箱钱包里有 99999 元随便测

---

## 九、常见问题 FAQ

### Q1：点击「立即购买」报「离线模式无法支付」
A：用户还没成功连接 Supabase。检查：
- `assets/supabase-inline.js` 里的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是否正确
- 网络是否通畅（DevTools Console 看是否有 `[元答] Supabase 初始化成功` 日志）

### Q2：跳到收银台是空白页 / 502
A：DaxPay 后端没起来或 Nginx 配置错。检查：
- `docker compose ps` 确认 daxpay 容器 healthy
- `curl http://localhost:9999` 是否能通
- Nginx 日志 `docker compose logs nginx`

### Q3：支付完成后积分没到账
A：异步通知可能没收到。检查：
- DaxPay 管理端 → 通知中心 → 是否调用了 `DAXPAY_NOTIFY_URL`
- Supabase Edge Function → daxpay-notify → Logs 看有没有收到请求
- 如果 DaxPay 报「通知地址不通」，检查：
  - 域名是否配置 HTTPS
  - Supabase URL 是否可公网访问
  - DaxPay 服务器能否访问外网（生产环境常常需要开放出站 443）

### Q4：验签失败 `[daxpay-notify] 验签失败`
A：可能是 DaxPay 实际签名规则与代码模板不一致。检查：
- DaxPay 管理端「系统配置 → 签名算法」用的是 MD5 还是 SHA256
- 如果是 MD5，修改 `supabase/functions/daxpay-notify/index.ts` 里的 `verifySign()`：
  ```typescript
  // 把 SHA-256 换成 MD5
  const buf = new TextEncoder().encode(base);
  const hash = await crypto.subtle.digest('MD5', buf);  // MD5 需要先 npm install crypto-js 或 import
  ```

### Q5：会员开通后，签到/月赠没生效
A：检查 `assets/supabase_setup.sql` 里 `claimDailyBonus` / `checkMonthlyBonus` 是否根据 `membership` 字段区分额度。supabase-inline.js 已经做了区分（free=10 / premium=20 / pro=50 / enterprise=100），直接生效。

### Q6：想加银联 / 云闪付
A：DaxPay Open 默认支持银联和云闪付，配置方式与微信/支付宝类似，前端在 `daxpay.js` 的 `POINTS_PACKAGES` 旁加一个 `'unionpay_h5'` 选项即可，Edge Function 的 `channel` 白名单要同步加。

### Q7：daxpay-create-order 返回的 cashierUrl 字段名不一样
A：DaxPay 不同版本返回结构可能不同。常见字段名：
- `data.cashierUrl`
- `data.payUrl`
- `cashierUrl`（根级）

代码中已经做了多字段兼容（见 `daxpay-create-order/index.ts` 第 117 行），如果还是取不到，请按你部署版本的实际返回结构调整。

### Q8：APK 里的 WebView 跳转收银台会被拦截
A：WebView 默认可能拦截外部跳转（`window.location.href`）。需在 WebView 配置里：
- 允许跳转任意 URL（不要 `allowedURLs` 限制）
- 启用 `JavaScriptCanOpenWindowsAutomatically = true`
- 启用 `setSupportMultipleWindows(true)`

如果用 uni-app 的 wap2app，还需要在 manifest.json 加：
```json
"plus": {
  "kernel": {
    "android": "WebviewPlus"
  }
}
```

---

## 十、文件清单

本次接入新增/修改的文件：

| 文件 | 类型 | 说明 |
|------|------|------|
| `supabase/functions/daxpay-create-order/index.ts` | 新增 | 创建订单 Edge Function（签名代理） |
| `supabase/functions/daxpay-create-order/deno.json` | 新增 | Deno 配置 |
| `supabase/functions/daxpay-notify/index.ts` | 新增 | 异步通知 Edge Function（验签+入账） |
| `supabase/functions/daxpay-notify/deno.json` | 新增 | Deno 配置 |
| `assets/daxpay.js` | 新增 | 前端 DaxPay 客户端 |
| `assets/daxpay_setup.sql` | 新增 | 数据库扩展 SQL |
| `assets/index.html` | 修改 | 引入 daxpay.js、加个人中心入口、替换演示代码、加支付方式弹窗 |
| `.env.daxpay.example` | 新增 | 环境变量清单 |
| `assets/DAXPAY_DEPLOY.md` | 新增 | 本部署文档 |

---

**🎉 部署完成后，建议先跑一次「最小金额 ¥0.01」的端到端测试，再正式上线。**
