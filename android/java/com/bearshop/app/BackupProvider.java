package com.bearshop.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * 极简文件分享通道（自己实现的 FileProvider）。
 *
 * 为什么不用 androidx.core.content.FileProvider：
 * 本工程刻意零依赖 —— 编译时只用 android.jar，不引任何 support/androidx 库，
 * 为的是让 APK 保持在 500KB 级别、构建链路简单可复现。
 *
 * 职责：把 App 私有缓存目录 <cache>/share/ 下的文件，通过
 *   content://com.bearshop.app.backup/<文件名>
 * 只读地暴露给外部应用（邮件客户端等）。
 * 外部应用必须拿到 Intent 上的 FLAG_GRANT_READ_URI_PERMISSION 才能读，
 * 且本 provider exported=false，不允许任何外部应用自行访问。
 */
public class BackupProvider extends ContentProvider {

    public static final String AUTHORITY = "com.bearshop.app.backup";
    public static final String DIR = "share";

    public static File dir(android.content.Context ctx) {
        return new File(ctx.getCacheDir(), DIR);
    }

    private File root() {
        return dir(getContext());
    }

    /** 把 uri 尾段解析成 root 内的文件，并挡住 ../ 之类的路径穿越 */
    private File resolve(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) return null;
        File base = root();
        File f = new File(base, name);
        try {
            String bp = base.getCanonicalPath();
            String fp = f.getCanonicalPath();
            if (!fp.equals(bp) && !fp.startsWith(bp + File.separator)) return null;
        } catch (IOException e) {
            return null;
        }
        return f;
    }

    @Override
    public boolean onCreate() {
        File d = root();
        return d.exists() || d.mkdirs();
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        String lower = n == null ? "" : n.toLowerCase();
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File f = resolve(uri);
        if (f == null || !f.exists()) return null;

        String[] cols = projection != null ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            else if ("_id".equals(cols[i])) row[i] = 1;
            else row[i] = null;
        }
        c.addRow(row);
        return c;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        if (f == null || !f.exists()) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
