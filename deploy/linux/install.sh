#!/bin/sh
# Campus Branch: start at boot on Linux (plan Revision 4). Run once with sudo from a built app folder (after npm ci and
# npm run build):   sudo sh deploy/linux/install.sh [path to a Node 24 binary]
# It creates the non-login account campus-branch, /var/lib/campus-branch (0700, owned by it), copies the app to
# /opt/campus-branch/app and Node to /opt/campus-branch/node (readable by the account; a Node under a home folder is
# not), then enables and starts the systemd service.
set -eu
APP_SRC=$(cd "$(dirname "$0")/../.." && pwd)
NODE_SRC=${1:-$(command -v node)}
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo.' >&2; exit 1; }
[ -f "$APP_SRC/.next/BUILD_ID" ] || { echo "No production build in $APP_SRC: run npm ci and npm run build first." >&2; exit 1; }
case "$("$NODE_SRC" --version)" in v24.*) ;; *) echo "Node 24 is required at $NODE_SRC." >&2; exit 1 ;; esac

id campus-branch >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin campus-branch
install -d -m 0700 -o campus-branch -g campus-branch /var/lib/campus-branch
install -d -m 0755 /opt/campus-branch /opt/campus-branch/node/bin
install -m 0755 "$NODE_SRC" /opt/campus-branch/node/bin/node
rm -rf /opt/campus-branch/app.new
cp -a "$APP_SRC" /opt/campus-branch/app.new
chown -R root:root /opt/campus-branch/app.new
chmod -R u+rwX,go+rX,go-w /opt/campus-branch/app.new
install -d -m 0700 -o campus-branch -g campus-branch /opt/campus-branch/app.new/.next/cache
rm -rf /opt/campus-branch/app.old
[ -d /opt/campus-branch/app ] && mv /opt/campus-branch/app /opt/campus-branch/app.old
mv /opt/campus-branch/app.new /opt/campus-branch/app

install -m 0644 "$APP_SRC/deploy/linux/campus-branch.service" /etc/systemd/system/campus-branch.service
systemctl daemon-reload
systemctl enable campus-branch.service
systemctl restart campus-branch.service
echo 'Campus Branch is installed and starting. Data folder: /var/lib/campus-branch'
echo 'Status: systemctl status campus-branch   Log: journalctl -u campus-branch   Stop: sudo systemctl stop campus-branch'
echo 'If not done yet, share the app over Tailscale once: tailscale serve --bg 3000'
