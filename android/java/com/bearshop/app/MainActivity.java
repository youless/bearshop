package com.bearshop.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * BearShop 手机 App 外壳。
 *
 * 设计要点：
 * 1. 网页资源全部打包在 assets/www 内，通过 shouldInterceptRequest 挂在
 *    https://appassets.androidplatform.net/ 这个虚拟域名下。
 *    用 https 而不是 file:// 是为了让页面处于「安全上下文」，
 *    从而 navigator.mediaDevices.getUserMedia（扫码）可以正常调用。
 * 2. 相机权限：网页发起 getUserMedia 时由 onPermissionRequest 授权。
 * 3. 保存标签图片：桥接方法写入系统相册（Pictures/BearShop）。
 * 4. 打印标签：桥接方法调用 Android 系统打印服务，可另存为 PDF 或直连打印机。
 * 5. 返回键：先交给网页处理（关闭弹层/回到首页），未消费则双击退出。
 */
public class MainActivity extends Activity {

    private static final String TAG = "BearShop";

    /** 与 WebViewAssetLoader 一致的保留域名，保证不会被真实解析到网络 */
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";

    private static final int REQ_CAMERA = 1001;
    private static final int REQ_STORAGE = 1002;
    private static final int REQ_FILE_CHOOSER = 1003;

    private static final int BEAR_BG = 0xFFF2F8FE;

    private WebView web;
    private PermissionRequest pendingCamera;
    private long lastBackAt = 0L;

    /** 「导入备份文件」：挂在系统文件选择器上的网页回调 */
    private ValueCallback<Uri[]> pendingFileChooser;

    /** 正在等系统权限弹窗返回：此时不能让 WebView onPause，否则挂起的 getUserMedia 会被取消 */
    private boolean awaitingPermission = false;
    private boolean cameraAskedBefore = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.parseColor("#EAF5FE"));
        getWindow().setNavigationBarColor(Color.parseColor("#EAF5FE"));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BEAR_BG);
        root.setFitsSystemWindows(true);

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        configureWebView();
        try { web.clearCache(true); } catch (Throwable ignore) {}   // 覆盖安装后清掉旧版网页缓存
        cameraAskedBefore = getPreferences(MODE_PRIVATE).getBoolean("cameraAskedBefore", false);
        web.loadUrl(START_URL);
    }

    /* ============================================================
       WebView 配置
       ============================================================ */
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // localStorage：商品与销售数据全靠它
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // 允许自动播放取景视频
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }
        s.setUserAgentString(s.getUserAgentString() + " BearShopApp/1.0.8");

        web.setBackgroundColor(BEAR_BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebView.setWebContentsDebuggingEnabled(false);

        web.addJavascriptInterface(new Bridge(), "BearShopNative");

        web.setWebViewClient(new WebViewClient() {

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && HOST.equals(u.getHost())) {
                    return serveAsset(u.getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null) return false;
                String scheme = u.getScheme();
                if (HOST.equals(u.getHost())) return false;           // 站内继续用 WebView
                if ("http".equals(scheme) || "https".equals(scheme)) { // 站外交给系统浏览器
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Exception e) {
                        toast(getString(R.string.app_name));
                    }
                    return true;
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsVideo = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
                    }
                    if (!wantsVideo) {
                        request.deny();
                        return;
                    }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        // 权限已就绪：必须同步授予，否则 WebView 会取消这次请求
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        // 兜底路径：正常情况下网页会先调 ensureCamera()，不会走到这里
                        pendingCamera = request;
                        awaitingPermission = true;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCamera == request) pendingCamera = null;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.lineNumber());
                return true;
            }

            /* 「导入备份文件」：<input type=file> 需要外壳实现文件选择，
               否则在 App 里点了没反应（浏览器里才默认可用） */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileChooser != null) {
                    pendingFileChooser.onReceiveValue(null);   // 取消上一次未完成的
                }
                pendingFileChooser = callback;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    // 不按 MIME 过滤：各家文件管理器给 CSV 标的类型五花八门
                    // （text/csv、text/plain、application/vnd.ms-excel 都有），过滤容易灰掉选不中，
                    // 选错的文件由网页内容校验兜底（会提示文件格式不正确）
                    i.setType("*/*");
                    startActivityForResult(Intent.createChooser(i, "选择备份文件（BearShop.csv）"),
                            REQ_FILE_CHOOSER);
                } catch (Throwable t) {
                    Log.w(TAG, "no file chooser available", t);
                    toast("本机没有可用的文件选择器");
                    pendingFileChooser.onReceiveValue(null);
                    pendingFileChooser = null;
                }
                return true;
            }
        });
    }

    /* ============================================================
       assets/www -> 虚拟 https 站点
       ============================================================ */
    private WebResourceResponse serveAsset(String rawPath) {
        String p = rawPath == null ? "" : rawPath;
        while (p.startsWith("/")) p = p.substring(1);
        if (p.isEmpty() || p.endsWith("/")) p = p + "index.html";
        if (p.contains("..")) return error(404, "Not Found");

        try {
            InputStream in = getAssets().open("www/" + p);
            Map<String, String> headers = new HashMap<>();
            // 网页资源全部打包在 APK 内，绝不允许缓存：否则覆盖安装后仍会跑旧版代码
            headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
            headers.put("Pragma", "no-cache");
            headers.put("Expires", "0");
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mimeOf(p), charsetOf(p) , 200, "OK", headers, in);
        } catch (IOException e) {
            Log.w(TAG, "asset missing: " + p);
            return error(404, "Not Found");
        }
    }

    private WebResourceResponse error(int code, String msg) {
        return new WebResourceResponse("text/plain", "utf-8", code, msg,
                new HashMap<String, String>(),
                new ByteArrayInputStream(msg.getBytes()));
    }

    private static String mimeOf(String p) {
        String f = p.toLowerCase();
        if (f.endsWith(".html") || f.endsWith(".htm")) return "text/html";
        if (f.endsWith(".css")) return "text/css";
        if (f.endsWith(".js") || f.endsWith(".mjs")) return "application/javascript";
        if (f.endsWith(".json") || f.endsWith(".webmanifest")) return "application/json";
        if (f.endsWith(".png")) return "image/png";
        if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
        if (f.endsWith(".svg")) return "image/svg+xml";
        if (f.endsWith(".webp")) return "image/webp";
        if (f.endsWith(".ico")) return "image/x-icon";
        if (f.endsWith(".woff2")) return "font/woff2";
        if (f.endsWith(".woff")) return "font/woff";
        if (f.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private static String charsetOf(String p) {
        String f = p.toLowerCase();
        if (f.endsWith(".html") || f.endsWith(".htm") || f.endsWith(".css") || f.endsWith(".js")
                || f.endsWith(".mjs") || f.endsWith(".json") || f.endsWith(".webmanifest")
                || f.endsWith(".svg")) {
            return "utf-8";
        }
        return null;
    }

    /* ============================================================
       与网页交互的桥
       ============================================================ */
    private class Bridge {

        @JavascriptInterface
        public String version() {
            return "1.0.8";
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        /**
         * 网页打开扫码界面时先调这个：把「申请相机权限」提前到调用摄像头之前完成。
         * 关键点 —— 如果等 WebView 的 onPermissionRequest 才去申请，
         * 系统弹窗会让 Activity 暂停，WebView 会直接取消掉那个挂起的 getUserMedia，
         * 结果既不成功也不报错，扫码就「没反应」。
         * 结果通过 window.BearShopCameraResult(ok, reason) 异步回调网页。
         */
        @JavascriptInterface
        public void ensureCamera() {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    notifyCamera(true, "granted");
                    return;
                }
                // 之前问过、且系统不再允许弹窗（用户选了“禁止且不再询问”）→ 只能去设置里开
                boolean blocked = cameraAskedBefore
                        && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA);
                if (blocked) {
                    notifyCamera(false, "blocked");
                    return;
                }
                cameraAskedBefore = true;
                getPreferences(MODE_PRIVATE).edit().putBoolean("cameraAskedBefore", true).apply();
                awaitingPermission = true;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            });
        }

        /** 跳到本应用的系统设置页，方便用户手动开权限 */
        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    i.setData(Uri.fromParts("package", getPackageName(), null));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Throwable t) {
                    toast("请到系统设置 → 应用 → BearShop → 权限 中开启相机");
                }
            });
        }

        @JavascriptInterface
        public void log(String msg) {
            Log.d(TAG, "web: " + msg);
        }

        @JavascriptInterface
        public void toastMsg(final String msg) {
            runOnUiThread(() -> toast(msg));
        }

        /** 把二维码 / 标签图片写入系统相册 */
        @JavascriptInterface
        public boolean saveImage(String filename, String dataUrl) {
            try {
                String name = safeName(filename, "bearshop.png");
                int comma = dataUrl.indexOf(',');
                if (comma < 0) return false;
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) return false;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                    cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    cv.put(MediaStore.Images.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/BearShop");
                    cv.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri uri = getContentResolver()
                            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return false;
                    OutputStream out = getContentResolver().openOutputStream(uri);
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                    if (out != null) out.close();
                    cv.clear();
                    cv.put(MediaStore.Images.Media.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> {
                            toast("请允许存储权限后重试");
                            requestPermissions(
                                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
                        });
                        return false;
                    }
                    File dir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                            "BearShop");
                    if (!dir.exists() && !dir.mkdirs()) return false;
                    OutputStream out = new FileOutputStream(new File(dir, name));
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                    out.close();
                }
                runOnUiThread(() -> toast("已保存到相册：Pictures/BearShop"));
                return true;
            } catch (Throwable t) {
                Log.e(TAG, "saveImage failed", t);
                return false;
            }
        }

        /** 保存文本（备份 CSV / JSON）到「下载」目录 */
        @JavascriptInterface
        public boolean saveText(String filename, String text) {
            try {
                String name = safeName(filename, "BearShop.csv");
                String mime = name.toLowerCase().endsWith(".csv")
                        ? "text/csv" : "application/json";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/BearShop");
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return false;
                    OutputStream out = getContentResolver().openOutputStream(uri);
                    out.write(text.getBytes("UTF-8"));
                    out.close();
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> {
                            toast("请允许存储权限后重试");
                            requestPermissions(
                                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
                        });
                        return false;
                    }
                    File dir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            "BearShop");
                    if (!dir.exists() && !dir.mkdirs()) return false;
                    OutputStream out = new FileOutputStream(new File(dir, name));
                    out.write(text.getBytes("UTF-8"));
                    out.close();
                }
                runOnUiThread(() -> toast("备份已保存到：下载/BearShop"));
                return true;
            } catch (Throwable t) {
                Log.e(TAG, "saveText failed", t);
                return false;
            }
        }

        /**
         * 把备份文件作为附件交给系统邮件应用：
         * 收件人 / 主题 / 正文 / 附件全部预填，用户只需点「发送」。
         *
         * 网页里的 mailto: 是带不了附件的，所以必须走这一步原生桥接。
         * 文件写到私有缓存 cache/share/，再用 BackupProvider 以只读 content:// 暴露，
         * Intent 上带 FLAG_GRANT_READ_URI_PERMISSION 临时授权给收件方。
         */
        @JavascriptInterface
        public boolean shareBackup(String filename, String text, String to, String subject, String body) {
            try {
                File dir = BackupProvider.dir(MainActivity.this);
                if (!dir.exists() && !dir.mkdirs()) return false;

                String name = safeName(filename, "BearShop.csv");
                File target = new File(dir, name);
                // 清掉上一次留下的临时文件，避免缓存目录里堆备份
                File[] olds = dir.listFiles();
                if (olds != null) {
                    for (File o : olds) {
                        if (!o.equals(target)) {
                            try { o.delete(); } catch (Throwable ignore) {}
                        }
                    }
                }
                FileOutputStream fos = new FileOutputStream(target);
                fos.write(text.getBytes("UTF-8"));
                fos.close();

                Uri uri = new Uri.Builder()
                        .scheme("content")
                        .authority(BackupProvider.AUTHORITY)
                        .appendPath(name)
                        .build();

                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/csv");
                if (to != null && to.trim().length() > 0) {
                    send.putExtra(Intent.EXTRA_EMAIL, new String[]{to.trim()});
                }
                send.putExtra(Intent.EXTRA_SUBJECT, subject == null ? name : subject);
                send.putExtra(Intent.EXTRA_TEXT, body == null ? "" : body);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                final Intent finalSend = send;
                runOnUiThread(() -> {
                    try {
                        // 只有一家能处理就直接进它（多数手机 = 自带邮件），否则弹选择器
                        List<ResolveInfo> apps = getPackageManager()
                                .queryIntentActivities(finalSend, PackageManager.MATCH_DEFAULT_ONLY);
                        if (apps.size() == 1) {
                            startActivity(finalSend);
                        } else {
                            Intent chooser = Intent.createChooser(finalSend, "发送备份邮件");
                            startActivity(chooser);
                        }
                    } catch (ActivityNotFoundException e) {
                        toast("没有找到邮件应用");
                    } catch (Throwable t) {
                        Log.e(TAG, "shareBackup launch failed", t);
                        toast("邮件应用打开失败");
                    }
                });
                return true;
            } catch (Throwable t) {
                Log.e(TAG, "shareBackup failed", t);
                return false;
            }
        }

        /** 调用系统打印服务打印标签（打印样式由网页 @media print 决定） */
        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> {
                try {
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (pm == null) { toast("当前设备不支持打印"); return; }
                    String job = "BearShop-Labels-" + System.currentTimeMillis();
                    pm.print(job, web.createPrintDocumentAdapter(job), null);
                } catch (Throwable t) {
                    Log.e(TAG, "print failed", t);
                    toast("打印不可用，可改用「保存图片」");
                }
            });
        }
    }

    private static String safeName(String raw, String fallback) {
        if (raw == null) return fallback;
        String n = raw.replaceAll("[\\\\/:*?\"<>|\\s]+", "_").trim();
        if (n.isEmpty()) return fallback;
        if (n.length() > 120) n = n.substring(0, 120);
        return n;
    }

    private void toast(final String msg) {
        try {
            Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
        }
    }

    /* ============================================================
       文件选择回调（导入备份文件）
       ============================================================ */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            ValueCallback<Uri[]> cb = pendingFileChooser;
            pendingFileChooser = null;
            if (cb != null) {
                cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /* ============================================================
       权限回调
       ============================================================ */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);

        if (requestCode != REQ_CAMERA) return;

        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        awaitingPermission = false;

        // 如果是网页直接发起的请求（兜底路径），一并答复 WebView
        if (pendingCamera != null) {
            if (granted) pendingCamera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingCamera.deny();
            pendingCamera = null;
        }

        // 答复等待中的网页：granted / denied / blocked
        notifyCamera(granted, granted ? "granted" : "denied");
        if (!granted) toast("没有相机权限就无法扫码");
    }

    /** 把相机权限结果回传给网页 */
    private void notifyCamera(final boolean ok, final String reason) {
        final String js = "window.BearShopCameraResult && window.BearShopCameraResult("
                + ok + ",'" + reason + "')";
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(js, null);
        });
    }

    /* ============================================================
       生命周期
       ============================================================ */
    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        // 权限弹窗导致的暂停不能让 WebView 一起暂停，否则挂起的摄像头请求会被取消
        if (web != null && !awaitingPermission) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("BearShopNative");
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.BearShopBack ? window.BearShopBack() : false)", value -> {
            if ("true".equals(value)) return;        // 网页已处理
            long now = System.currentTimeMillis();
            if (now - lastBackAt < 2000) {
                finish();
            } else {
                lastBackAt = now;
                toast("再按一次退出 BearShop");
            }
        });
    }
}
