#!/bin/sh
# 一键部署（可重复执行），自动适配 Alpine/OpenRC 与 systemd 系统：
#   sudo sh deploy/bootstrap.sh
set -eu

APP_USER=wxauth
APP_DIR=/opt/wx-auth
NODE_VERSION=${NODE_VERSION:-v22.14.0}
NODE_MIRROR=${NODE_MIRROR:-https://mirrors.aliyun.com/nodejs-release}
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmmirror.com}

log() { echo "[bootstrap] $*"; }
die() { echo "[bootstrap] $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "请用 root 运行"
SRC_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

# ---------- 1. Node ----------
node_major=0
if command -v node >/dev/null 2>&1; then
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
fi

if [ "$node_major" -ge 18 ]; then
  log "已有 $(node -v)，跳过安装"
elif command -v apk >/dev/null 2>&1; then
  # Alpine 是 musl libc，只能用仓库里的 musl 版 Node，官方二进制跑不起来
  log "apk 安装 nodejs npm"
  apk add --no-cache nodejs npm
  node_major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$node_major" -ge 18 ] || die "仓库里的 Node 太旧（$(node -v)），需要 18+，请升级 Alpine"
  log "Node 就绪：$(node -v)"
else
  case $(uname -m) in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "不支持的架构 $(uname -m)" ;;
  esac
  pkg="node-${NODE_VERSION}-linux-${arch}.tar.xz"
  log "下载 Node ${NODE_VERSION}"
  cd /tmp
  curl -fsSL --retry 3 -O "$NODE_MIRROR/$NODE_VERSION/$pkg"
  curl -fsSL --retry 3 -O "$NODE_MIRROR/$NODE_VERSION/SHASUMS256.txt"
  grep " $pkg\$" SHASUMS256.txt | sha256sum -c - || die "安装包校验失败"
  mkdir -p /usr/local/lib
  rm -rf "/usr/local/lib/node-$NODE_VERSION"
  tar -xJf "$pkg" -C /usr/local/lib
  mv "/usr/local/lib/node-${NODE_VERSION}-linux-${arch}" "/usr/local/lib/node-$NODE_VERSION"
  ln -sfn "/usr/local/lib/node-$NODE_VERSION/bin/node" /usr/local/bin/node
  ln -sfn "/usr/local/lib/node-$NODE_VERSION/bin/npm" /usr/local/bin/npm
  rm -f "$pkg" SHASUMS256.txt
  log "Node 就绪：$(/usr/local/bin/node -v)"
fi
NODE_BIN=$(command -v node)

# ---------- 2. 用户与目录 ----------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "创建用户 $APP_USER"
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /sbin/nologin "$APP_USER"
  else
    addgroup -S "$APP_USER" 2>/dev/null || true
    adduser -S -D -H -s /sbin/nologin -G "$APP_USER" "$APP_USER"
  fi
fi

if [ "$SRC_DIR" != "$APP_DIR" ]; then
  log "同步代码到 $APP_DIR"
  mkdir -p "$APP_DIR"
  tar -C "$SRC_DIR" --exclude=.git --exclude=node_modules --exclude=.cache --exclude=.env -cf - . |
    tar -C "$APP_DIR" -xf -
fi
mkdir -p "$APP_DIR/.cache"

# ---------- 3. 配置 ----------
cd "$APP_DIR"
first_run=0
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    # 模板不在（比如上传时漏了隐藏文件）也能继续，直接写最小配置
    cat > .env <<'ENVEOF'
WX_APP_ID=
WX_APP_SECRET=
ALLOWED_HOSTS=
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=loopback
ENVEOF
  fi
  chmod 600 .env
  first_run=1
fi
chown -R "$APP_USER:$APP_USER" .cache .env

# ---------- 4. 依赖 ----------
log "安装依赖"
npm install --omit=dev --no-audit --no-fund --registry "$NPM_REGISTRY"

# ---------- 5. 服务 ----------
if command -v rc-update >/dev/null 2>&1; then
  log "安装 OpenRC 服务"
  sed "s#^command=.*#command=\"$NODE_BIN\"#" deploy/wx-auth.openrc > /etc/init.d/wx-auth
  chmod 755 /etc/init.d/wx-auth
  rc-update add wx-auth default >/dev/null 2>&1 || true
  START="rc-service wx-auth start"
  RESTART="rc-service wx-auth restart"
  LOGS="tail -f /var/log/wx-auth.log"
elif command -v systemctl >/dev/null 2>&1; then
  log "安装 systemd 服务"
  sed "s#^ExecStart=.*#ExecStart=$NODE_BIN $APP_DIR/src/server.js#" deploy/wx-auth.service \
    > /etc/systemd/system/wx-auth.service
  systemctl daemon-reload
  systemctl enable wx-auth >/dev/null
  START="systemctl start wx-auth"
  RESTART="systemctl restart wx-auth"
  LOGS="journalctl -u wx-auth -f"
else
  die "既没有 OpenRC 也没有 systemd，无法安装服务"
fi

if [ "$first_run" = 1 ]; then
  echo
  log "请填好 $APP_DIR/.env（WX_APP_ID / WX_APP_SECRET / ALLOWED_HOSTS）后启动："
  echo "  vi $APP_DIR/.env && $START"
  exit 0
fi

log "重启服务"
$RESTART
sleep 2
port=$(grep -m1 -E '^[[:space:]]*PORT[[:space:]]*=[[:space:]]*[0-9]+' .env | tr -dc '0-9' || true)
"$NODE_BIN" -e "fetch('http://127.0.0.1:${port:-3000}/healthz').then(r=>{console.log('healthz',r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(String(e));process.exit(1)})" ||
  die "启动异常，看日志：$LOGS"
log "完成。日志：$LOGS"
