#!/usr/bin/env bash
# 一键部署（可重复执行）：装 Node → 建用户 → 装依赖 → 装 systemd 服务
#   sudo bash deploy/bootstrap.sh
set -euo pipefail

APP_USER=wxauth
APP_DIR=/opt/wx-auth
NODE_VERSION=${NODE_VERSION:-v22.14.0}
NODE_MIRROR=${NODE_MIRROR:-https://mirrors.aliyun.com/nodejs-release}

log() { echo "[bootstrap] $*"; }
die() { echo "[bootstrap] $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 sudo 运行"
SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# 1. Node（已有 18+ 就跳过）
if [[ $(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0) -ge 18 ]]; then
  log "已有 $(node -v)，跳过安装"
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

# 2. 专用用户 + 代码目录
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin "$APP_USER"
if [[ $SRC_DIR != "$APP_DIR" ]]; then
  log "同步代码到 $APP_DIR"
  mkdir -p "$APP_DIR"
  tar -C "$SRC_DIR" --exclude=.git --exclude=node_modules --exclude=.cache --exclude=.env -cf - . |
    tar -C "$APP_DIR" -xf -
fi
mkdir -p "$APP_DIR/.cache"

# 3. 配置
cd "$APP_DIR"
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  first_run=1
fi
chown -R "$APP_USER:$APP_USER" .cache .env

# 4. 依赖 + 服务
log "安装依赖"
npm install --omit=dev --no-audit --no-fund --registry "${NPM_REGISTRY:-https://registry.npmmirror.com}"
install -m 644 deploy/wx-auth.service /etc/systemd/system/wx-auth.service
systemctl daemon-reload
systemctl enable wx-auth >/dev/null

if [[ ${first_run:-0} == 1 ]]; then
  echo
  log "请填好 $APP_DIR/.env（WX_APP_ID / WX_APP_SECRET / ALLOWED_HOSTS）后启动："
  echo "  sudo vi $APP_DIR/.env && sudo systemctl start wx-auth"
  exit 0
fi

systemctl restart wx-auth
sleep 1
curl -fsS http://127.0.0.1:3000/healthz && echo || die "启动失败，看 journalctl -u wx-auth -n 30"
log "完成"
