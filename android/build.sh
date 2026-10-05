#!/usr/bin/env bash
# BearShop · Android APK 一键构建脚本
# 工具链：aapt2 / d8 / zipalign / apksigner (build-tools 34) + JDK 17 + android-34 platform
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"                                # 项目根目录（web/ + android/）
AT="${ANDROID_TOOLS:-C:/Users/Administrator/WorkBuddy/2026-10-01-20-45-40/android-tools}"
BT="$AT/build-tools"
AJ="$AT/platform/android.jar"
JDK="$AT/jdk/bin"
PROJ="$ROOT/android"
WEB="$ROOT/web"
OUT="$PROJ/build"
DESKTOP="${DESKTOP_DIR:-C:/Users/Administrator/Desktop}"   # 产物直接输出到电脑桌面
FINAL="$DESKTOP/BearShop.apk"

export JAVA_HOME="$AT/jdk"
export PATH="$JDK:$PATH"

echo "==> 0. 同步网页资源到 assets/www"
rm -rf "$PROJ/assets/www"
mkdir -p "$PROJ/assets"
cp -r "$WEB" "$PROJ/assets/www"
find "$PROJ/assets/www" -name ".DS_Store" -delete 2>/dev/null || true

echo "==> 1. 清理构建目录"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> 2. aapt2 编译资源"
"$BT/aapt2.exe" compile --dir "$PROJ/res" -o "$OUT/res.zip"

echo "==> 3. aapt2 链接资源 + 清单"
"$BT/aapt2.exe" link \
  -o "$OUT/app.unsigned.apk" \
  -I "$AJ" \
  --manifest "$PROJ/AndroidManifest.xml" \
  -A "$PROJ/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  "$OUT/res.zip"

echo "==> 4. javac 编译 Java 源码"
"$JDK/javac.exe" -encoding UTF-8 \
  -source 8 -target 8 \
  -classpath "$AJ" \
  -d "$OUT/classes" \
  $(find "$PROJ/java" -name "*.java") \
  "$OUT/gen/com/bearshop/app/R.java" 2>&1 | tr -d '\0' | grep -a -v "bootstrap class path\|source value 8\|target value 8" || true
test -f "$OUT/classes/com/bearshop/app/MainActivity.class"
test -f "$OUT/classes/com/bearshop/app/BackupProvider.class"

echo "==> 5. d8 编译为 DEX"
export JAVA_HOME="$AT/jdk"
export PATH="$JDK:$PATH"
"$BT/d8.bat" --release --min-api 24 --lib "$AJ" --output "$OUT/dex" \
  $(find "$OUT/classes" -name "*.class") 2>&1 | grep -v "^$" || true
test -f "$OUT/dex/classes.dex"

echo "==> 6. 把 classes.dex 塞进 APK"
"C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe" - "$OUT/app.unsigned.apk" "$OUT/dex/classes.dex" <<'PY'
import sys, zipfile, shutil, os
apk, dex = sys.argv[1], sys.argv[2]
tmp = apk + '.tmp'
with zipfile.ZipFile(apk) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename == 'classes.dex':
            continue
        zout.writestr(item, zin.read(item.filename))
    zout.write(dex, 'classes.dex')
os.replace(tmp, apk)
print('   classes.dex 已加入')
PY

echo "==> 7. zipalign 4 字节对齐"
"$BT/zipalign.exe" -f -p 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

echo "==> 8. 生成签名密钥（首次）"
KS="${BEARSHOP_KS:-$PROJ/bearshop-release.keystore}"
KS_PASS="${BEARSHOP_KS_PASS:-bearshop2026}"
if [ ! -f "$KS" ]; then
  "$JDK/keytool.exe" -genkeypair -v \
    -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias bearshop -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=BearShop, OU=BearShop, O=BearShop, C=CN" 2>&1 | tail -2
  echo "   密钥已生成：$KS（请妥善保存，后续升级必须用同一把签名）"
fi

echo "==> 9. apksigner 签名"
"$BT/apksigner.bat" sign \
  --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias bearshop \
  --out "$FINAL" "$OUT/app.aligned.apk"

echo "==> 10. 校验签名"
"$BT/apksigner.bat" verify --print-certs "$FINAL" | head -6

echo
echo "✔ 构建完成：$FINAL ($(du -h "$FINAL" | cut -f1))"
