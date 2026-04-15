#!/usr/bin/env bash
# 在 android/ 目录生成正式签名证书与 keystore.properties（均已 .gitignore）
# 用法：在终端执行  bash android/generate-release-keystore.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

resolve_keytool() {
  if command -v keytool >/dev/null 2>&1; then
    echo "keytool"
    return 0
  fi
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/keytool" ]]; then
    echo "${JAVA_HOME}/bin/keytool"
    return 0
  fi
  local jbr="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
  if [[ -x "$jbr" ]]; then
    echo "$jbr"
    return 0
  fi
  return 1
}

KEYTOOL="$(resolve_keytool)" || {
  echo "未找到 keytool。请先安装 JDK 17+，或安装 Android Studio，然后：" >&2
  echo "  export JAVA_HOME=\$(/usr/libexec/java_home 2>/dev/null)" >&2
  echo "再重新运行本脚本。" >&2
  exit 1
}

KS="mikujar-release.jks"
ALIAS="mikujar"
if [[ -f "$KS" ]]; then
  echo "已存在 $KS，为避免覆盖已退出。若确要重建请先手动删除该文件。" >&2
  exit 1
fi

PASS="$(openssl rand -hex 16)"
"$KEYTOOL" -genkeypair -v \
  -keystore "$KS" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=Mikujar Note, OU=Mobile, O=Mikujar, L=Shanghai, ST=Shanghai, C=CN"

{
  echo "storePassword=$PASS"
  echo "keyPassword=$PASS"
  echo "keyAlias=$ALIAS"
  echo "storeFile=$KS"
} > keystore.properties
chmod 600 "$KS" keystore.properties

echo "已生成："
echo "  $ROOT/$KS"
echo "  $ROOT/keystore.properties（密码仅在此文件，勿提交 Git）"
echo ""
echo "查看 MD5（备案用）：用 keystore.properties 里的 storePassword 作为 -storepass，执行："
echo "  \"$KEYTOOL\" -list -v -keystore \"$ROOT/$KS\" -alias $ALIAS"
