# wx-auth

微信 JS-SDK 鉴权服务：托管 access_token / jsapi_ticket，给前端下发 `wx.config` 需要的签名。
业务项目（比如要用 `wx.openLocation`）只调一个接口，不接触 AppSecret。

## 接口

```
GET  /api/wx/jsapi-signature?url=<encodeURIComponent(location.href.split('#')[0])>
POST /api/wx/jsapi-signature   { "url": "https://m.example.com/page" }
```

响应：

```json
{
  "ok": true,
  "data": {
    "appId": "wx...",
    "timestamp": 1755000000,
    "nonceStr": "a1b2c3d4e5f6a7b8",
    "signature": "40 位 sha1",
    "url": "https://m.example.com/page"
  }
}
```

前端用法（url 必须与当前页面完全一致，否则微信报 invalid signature）：

```js
const url = location.href.split('#')[0];
const res = await fetch(`https://auth.example.com/api/wx/jsapi-signature?url=${encodeURIComponent(url)}`, {
  headers: { 'X-API-Key': '<可选，配了 API_KEYS 才需要>' },
});
const { data } = await res.json();
wx.config({ ...data, jsApiList: ['openLocation'] });
```

另有 `GET /healthz`（存活探测）和 `GET /admin/status`（配了 `ADMIN_TOKEN` 才开放，看凭证缓存状态）。

错误统一返回 `{ ok: false, code, message }`，常见 code：`URL_REQUIRED`、`URL_NOT_HTTPS`、`HOST_NOT_ALLOWED`、`API_KEY_INVALID`、`RATE_LIMITED`。

## 部署（阿里云轻量 / ECS）

脚本自动适配 Alpine（OpenRC）和 Debian/Ubuntu/CentOS（systemd）：

```bash
git clone <你的仓库> /opt/wx-auth && cd /opt/wx-auth
sudo sh deploy/bootstrap.sh            # 装 Node + 建用户 + 装依赖 + 装服务
sudo vi /opt/wx-auth/.env              # 填 WX_APP_ID / WX_APP_SECRET / ALLOWED_HOSTS
```

启动、看状态、看日志：

| | Alpine（OpenRC） | systemd |
| --- | --- | --- |
| 启动 | `rc-service wx-auth start` | `systemctl start wx-auth` |
| 重启 | `rc-service wx-auth restart` | `systemctl restart wx-auth` |
| 状态 | `rc-service wx-auth status` | `systemctl status wx-auth` |
| 日志 | `tail -f /var/log/wx-auth.log` | `journalctl -u wx-auth -f` |

验证：`curl http://127.0.0.1:3000/healthz`

更新代码：`cd /opt/wx-auth && git pull && npm install --omit=dev && sudo rc-service wx-auth restart`（systemd 换成 `systemctl restart wx-auth`）

服务默认只监听 `127.0.0.1:3000`，自己用 Nginx 反代到它并配好 https 即可（`TRUST_PROXY=loopback` 已适配本机反代，用于限流取真实 IP）。

Alpine 注意两点：Node 必须用 apk 装的 musl 版本（官方 glibc 二进制跑不起来，脚本已处理）；日志走文件，量很小（只记启动、凭证刷新和错误），要轮转就 `apk add logrotate` 后加一份 `/etc/logrotate.d/wx-auth`。

## 为什么不会挂

- 进程退出 2 秒内自动拉起、开机自启：systemd 用 `Restart=always`，Alpine 用 `supervise-daemon`；5 分钟内重启超过 20 次才放弃，避免配置写错时无限刷日志
- 未捕获异常 / 未处理 Promise 拒绝主动退出，交给 init 拉起，不带着不确定状态继续服务
- 启动即预热凭证，之后每 30 分钟后台刷新，签名请求走内存缓存，不在请求链路里等微信接口
- 微信接口故障时，只要手上的 ticket 还没真正过期就继续用（凭证提前 5 分钟视为过期，留出降级空间）
- 凭证落盘 `.cache/`，重启不用重新换 token
- 限制 V8 堆 192M，避免小内存机器上被 OOM killer 挑中

## 配置

复制 `.env.example` 为 `.env`，必填三项：

| 变量 | 说明 |
| --- | --- |
| `WX_APP_ID` / `WX_APP_SECRET` | 公众号凭证，且公众号后台要把页面域名加入「JS 接口安全域名」 |
| `ALLOWED_HOSTS` | 允许被签名的页面域名，逗号分隔，支持 `*.example.com`。不限制的话别人能拿你的服务给自己站点签名 |

常用可选项：`API_KEYS`（非空则要求 `X-API-Key`）、`ADMIN_TOKEN`、`RATE_LIMIT_MAX`（默认 60 次/分钟/IP）、`ALLOWED_ORIGINS`（跨域来源默认取 `ALLOWED_HOSTS`，只有调用方域名和可签名域名不一致时才需要填），其余见 `.env.example`。

## 开发

```bash
npm install
cp .env.example .env
npm run dev     # node --watch
npm test        # node:test，含假微信服务端的接口测试
```
