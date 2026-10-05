# BearShop（小熊收银）· 扫码销售记账 App

给小卖部、便利店、水果摊、档口小店用的扫码销售工具。不用注册、不联网也能用，装上就开工。

## 功能

- **扫码售出**：扫商品二维码，品名单价自动带出，点结算即完成收款
- **扫码入库**：扫码 + 填品名数量即可登记，自动生成带品名的商品二维码，可保存图片或打印标签
- **按件 / 按公斤计价**：标价商品按件卖，散称商品按重量卖，数量支持小数
- **库存管理**：售出自动扣库存，库存不足时扫码提醒核对
- **销售记录**：每日单量、营业额、与昨日对比
- **数据备份**：一键导出 BearShop.csv（本地 / 发到邮箱），支持导入恢复
- **中英双语**：界面可一键切换 English

## 项目结构

```
bearshop/
├── web/                     # 前端源码（PWA，离线可用）
│   ├── index.html           # 主界面（销售 / 入库 / 商品 / 记录 / 设置）
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js           # 主逻辑与页面渲染
│   │   ├── store.js         # 本地数据存储
│   │   ├── bears.js         # 商品二维码生成与打印
│   │   ├── scanner.js       # 扫码（摄像头）
│   │   └── i18n.js          # 中英文文案
│   ├── vendor/              # jsQR、qrcode-generator（本地内置，不依赖 CDN）
│   ├── icons/               # 应用图标
│   ├── manifest.webmanifest
│   └── sw.js                # Service Worker（离线缓存）
└── android/                 # Android 壳工程（WebView 承载 web/，含原生备份分享）
    ├── AndroidManifest.xml
    ├── java/com/bearshop/app/
    │   ├── MainActivity.java      # WebView 容器 + 配置
    │   └── BackupProvider.java    # 备份文件导出（FileProvider 式 content://）
    ├── res/                       # 图标、颜色、主题
    └── build.sh                   # 一键构建 APK
```

包名：`com.bearshop.app`　minSdk 24 / targetSdk 34

## 构建

`android/build.sh` 为手工构建链（aapt2 编译资源 → 链接清单 → javac → d8 生成 dex → 塞入 APK → zipalign 对齐 → apksigner 签名），产物输出到桌面 `BearShop.apk`。

依赖本机 Android 构建工具（build-tools 34 + platform android-34 + JDK 17），路径通过环境变量指定：

```bash
export ANDROID_TOOLS=/path/to/android-tools     # 内含 build-tools / platform / jdk
export BEARSHOP_KS=/path/to/bearshop-release.keystore    # 可选，缺省用 android/ 下的密钥
export BEARSHOP_KS_PASS=********                          # 可选，签名密码
bash android/build.sh
```

构建时会把 `web/` 自动同步到 `android/assets/www`（该目录为生成物，未纳入版本库）。
签名密钥（`*.keystore`）与构建产物（APK）同样未纳入版本库，请自行备份保管。

## 说明

数据全部保存在本机，不上传服务器；源码仅供学习与个人使用。
