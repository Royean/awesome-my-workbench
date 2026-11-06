package dev.awesome.myworkbench;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOME = "https://vivid-dream.online/";
    private static final int FILE_REQUEST = 101, SAVE_REQUEST = 102, MIC_REQUEST = 103;
    private WebView web;
    private LinearLayout root;
    private FrameLayout content;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest audioRequest;
    private String saveUrl, saveCookie, saveMime;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private boolean failed = false;

    static boolean trusted(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && "vivid-dream.online".equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private void message(String text) { if(!isFinishing() && !isDestroyed()) Toast.makeText(this,text,Toast.LENGTH_LONG).show(); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(245,246,244));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            if(Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));
            } else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(8),0,dp(8),0);
        Button back = new Button(this); back.setText("‹"); back.setTextSize(25); back.setContentDescription("返回上一页"); back.setBackgroundColor(Color.TRANSPARENT); back.setOnClickListener(v -> back());
        toolbar.addView(back,new LinearLayout.LayoutParams(dp(48),dp(48)));
        TextView title = new TextView(this); title.setText("我的工作台"); title.setTextSize(15); title.setTextColor(Color.rgb(35,56,47)); title.setGravity(Gravity.CENTER);
        toolbar.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));
        Button menu = new Button(this); menu.setText("⋮"); menu.setTextSize(23); menu.setContentDescription("应用菜单"); menu.setBackgroundColor(Color.TRANSPARENT); menu.setOnClickListener(v -> menu(v));
        toolbar.addView(menu,new LinearLayout.LayoutParams(dp(48),dp(48))); root.addView(toolbar);
        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal); progress.setMax(100); root.addView(progress,new LinearLayout.LayoutParams(-1,dp(2)));
        content = new FrameLayout(this); root.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        makeWebView();
        errorPanel = new LinearLayout(this); errorPanel.setOrientation(LinearLayout.VERTICAL); errorPanel.setGravity(Gravity.CENTER); errorPanel.setPadding(dp(30),dp(30),dp(30),dp(30)); errorPanel.setBackgroundColor(Color.rgb(245,246,244));
        errorText = new TextView(this); errorText.setTextSize(16); errorText.setGravity(Gravity.CENTER); errorText.setTextColor(Color.rgb(35,56,47)); errorPanel.addView(errorText,new LinearLayout.LayoutParams(-1,-2));
        Button retry = new Button(this); retry.setText("重新连接"); retry.setOnClickListener(v -> { if(web == null) makeWebView(); load(HOME); });
        LinearLayout.LayoutParams retryLayout = new LinearLayout.LayoutParams(-2,-2); retryLayout.topMargin=dp(24); errorPanel.addView(retry,retryLayout);
        content.addView(errorPanel,new FrameLayout.LayoutParams(-1,-1)); errorPanel.setVisibility(View.GONE);
        if(Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::back);
        Uri incoming=getIntent().getData();
        if(state != null && web.restoreState(state) != null) { /* keep current page after process recreation */ }
        else if(trusted(incoming)) load(incoming.toString());
        else load(HOME);
    }

    private void makeWebView() {
        web = new WebView(this); web.setBackgroundColor(Color.rgb(245,246,244));
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings=web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true); settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setUserAgentString(settings.getUserAgentString()+" AwesomeMyWorkbench/0.7.4");
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri=req.getUrl();
                if(!trusted(uri)) { if(req.isForMainFrame()) external(uri); return true; }
                if(req.isForMainFrame() && "/app/collectors".equals(uri.getPath())) { startActivity(new Intent(MainActivity.this,CaptureSettingsActivity.class)); return true; }
                if(req.isForMainFrame() && "/api/export".equals(uri.getPath())) { save(uri.toString(),"application/json",null); return true; }
                return false;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String scheme=req.getUrl().getScheme();
                if("file".equalsIgnoreCase(scheme)||"content".equalsIgnoreCase(scheme)||"http".equalsIgnoreCase(scheme)||("https".equalsIgnoreCase(scheme)&&!trusted(req.getUrl())))
                    return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                if(!trusted(Uri.parse(url))) {view.stopLoading();showError("此页面不属于工作台\n请重新连接继续使用。");return;}
                failed=false; if(errorPanel!=null)errorPanel.setVisibility(View.GONE); progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view,String url) {
                CookieManager.getInstance().flush(); progress.setVisibility(View.GONE);
                if(!failed && trusted(Uri.parse(url))) {
                    // Use normal authenticated HTTPS downloads; do not expose a JavaScript bridge.
                    view.evaluateJavascript("(()=>{if(window.__awesomeExport)return;window.__awesomeExport=true;document.addEventListener('click',e=>{if(!e.target.closest?.('[data-action=export]'))return;e.preventDefault();e.stopImmediatePropagation();const s=localStorage.getItem('health-space')||'personal',w=localStorage.getItem('active-workbench')||'health';location.href='/api/export?space='+encodeURIComponent(s)+'&workbench='+encodeURIComponent(w)},true);document.addEventListener('visibilitychange',()=>{const b=document.querySelector('#capture-record');if(document.hidden&&b?.textContent.includes('停止录音'))b.click()})})()",null);
                }
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error) { if(req.isForMainFrame()) showError("暂时无法连接工作台\n检查网络后重新连接，已有记录仍保存在账号中。"); }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) { handler.cancel(); showError("连接的安全证书无法验证\n请稍后重试，不会继续发送账号资料。"); }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail) {
                content.removeView(view); view.destroy(); web=null; showError("页面已暂停\n点击重新连接继续使用。"); return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int n) { progress.setProgress(n); }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                if(!trusted(Uri.parse(view.getUrl()==null?"":view.getUrl()))) { callback.onReceiveValue(null); return true; }
                fileCallback=callback;
                try { Intent intent=params.createIntent(); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); startActivityForResult(intent,FILE_REQUEST); }
                catch(ActivityNotFoundException | SecurityException e) { fileCallback.onReceiveValue(null); fileCallback=null; message("没有可用的文件选择器，请安装或启用系统文件应用。"); }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if(audioRequest!=null)audioRequest.deny(); audioRequest=null;
                    if(!trusted(request.getOrigin()) || web==null || !trusted(Uri.parse(web.getUrl()==null?"":web.getUrl()))) {request.deny();return;}
                    boolean microphone=false; for(String resource:request.getResources()) if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource))microphone=true;
                    if(!microphone) {request.deny();return;}
                    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else {audioRequest=request;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MIC_REQUEST);}
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if(audioRequest==request)audioRequest=null; }
        });
        web.setDownloadListener((url,ua,disposition,mime,size) -> save(url,mime,disposition));
        content.addView(web,0,new FrameLayout.LayoutParams(-1,-1));
    }

    private static boolean downloadable(Uri uri) {
        String path=uri.getPath();
        return "/api/export".equals(path) || (path!=null && path.startsWith("/api/files/"));
    }
    private void load(String url) { if(trusted(Uri.parse(url)) && "/app/collectors".equals(Uri.parse(url).getPath())) {if(web!=null && web.getUrl()==null)web.loadUrl(HOME);startActivity(new Intent(this,CaptureSettingsActivity.class));return;} if(web!=null && trusted(Uri.parse(url))) {failed=false;errorPanel.setVisibility(View.GONE);web.loadUrl(url);} }
    private void showError(String text) { failed=true;progress.setVisibility(View.GONE);if(errorPanel!=null){errorText.setText(text);errorPanel.setVisibility(View.VISIBLE);} }
    private void external(Uri uri) {
        if(!"https".equalsIgnoreCase(uri.getScheme())) {message("此链接不能在工作台中打开。");return;}
        new AlertDialog.Builder(this).setTitle("打开外部链接？").setMessage("将在浏览器中打开：\n"+uri.getHost()).setNegativeButton("取消",null)
            .setPositiveButton("打开",(d,w)->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException e){message("没有可用的浏览器。");}}).show();
    }
    private void menu(View anchor) {
        PopupMenu menu=new PopupMenu(this,anchor);menu.getMenu().add(0,1,0,"重新加载");menu.getMenu().add(0,2,1,"打开网页版");menu.getMenu().add(0,3,2,"关于工作台");menu.getMenu().add(0,4,3,"手机采集设置");
        menu.setOnMenuItemClickListener(item->{if(item.getItemId()==4){startActivity(new Intent(this,CaptureSettingsActivity.class));}else if(item.getItemId()==1){if(web==null)makeWebView();load(HOME);}else if(item.getItemId()==2){try{Intent browser=Intent.createChooser(new Intent(Intent.ACTION_VIEW,Uri.parse(HOME)),"选择浏览器");browser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS,new android.content.ComponentName[]{getComponentName()});startActivity(browser);}catch(ActivityNotFoundException e){message("请在浏览器中打开 vivid-dream.online");}}else new AlertDialog.Builder(this).setTitle("我的工作台 0.7.4").setMessage("健康、金融与其他日常安排\n\n连接你的腾讯云账号，读取和保存记录需要联网。\n附件由你选择后才会上传；麦克风仅在录音时请求权限。").setPositiveButton("知道了",null).show();return true;});menu.show();
    }
    private void back() {
        if(web==null||failed){moveTaskToBack(true);return;}
        web.evaluateJavascript("(()=>{if(document.querySelector('.drawer')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return true}return false})()",handled->{if(!"true".equals(handled)){if(web!=null&&web.canGoBack())web.goBack();else moveTaskToBack(true);}});
    }
    @Override public boolean onKeyUp(int key,android.view.KeyEvent event) {
        // API 33+ uses the registered predictive-back dispatcher; only legacy devices dispatch this key.
        if(Build.VERSION.SDK_INT<33 && key==android.view.KeyEvent.KEYCODE_BACK){back();return true;}
        return super.onKeyUp(key,event);
    }
    @Override protected void onNewIntent(Intent intent) {super.onNewIntent(intent);setIntent(intent);Uri uri=intent.getData();if(trusted(uri)){if(web==null)makeWebView();load(uri.toString());}}
    @Override protected void onSaveInstanceState(Bundle state) {if(web!=null)web.saveState(state);super.onSaveInstanceState(state);}
    @Override protected void onResume() {super.onResume();if(web!=null)web.onResume();CaptureCoordinator.kick(this,true);}
    @Override protected void onPause() { if(web!=null){web.evaluateJavascript("(()=>{const b=document.querySelector('#capture-record');if(b?.textContent.includes('停止录音'))b.click()})()",null);web.onPause();CookieManager.getInstance().flush();}super.onPause(); }
    @Override protected void onStop() {if(audioRequest!=null){audioRequest.deny();audioRequest=null;}super.onStop();}
    @Override protected void onDestroy() {if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}if(audioRequest!=null){audioRequest.deny();audioRequest=null;}if(web!=null){content.removeView(web);web.destroy();web=null;}downloads.shutdown();super.onDestroy();}
    @Override public void onRequestPermissionsResult(int request,String[] names,int[] results) {
        super.onRequestPermissionsResult(request,names,results);
        if(request==MIC_REQUEST&&audioRequest!=null){PermissionRequest pending=audioRequest;audioRequest=null;if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED&&trusted(pending.getOrigin())&&web!=null&&trusted(Uri.parse(web.getUrl()==null?"":web.getUrl())))pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else pending.deny();}
    }
    private void save(String url,String mime,String disposition) {
        Uri uri=Uri.parse(url);
        if(!trusted(uri)||!downloadable(uri)){message("此内容无法直接下载，请使用工作台中的下载或导出入口。");return;}
        if(saveUrl!=null){message("请先完成当前的文件保存。");return;}
        saveUrl=url;saveCookie=CookieManager.getInstance().getCookie(url);saveMime="/api/export".equals(uri.getPath())?"application/json":mime;
        String filename="/api/export".equals(uri.getPath())?"workbench-"+System.currentTimeMillis()+".json":android.webkit.URLUtil.guessFileName(url,disposition,mime);
        filename=filename.replaceAll("[\\\\/\\p{Cntrl}]","_");if(filename.length()>150)filename=filename.substring(filename.length()-150);
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(saveMime==null?"application/octet-stream":saveMime);intent.putExtra(Intent.EXTRA_TITLE,filename);
        try{startActivityForResult(intent,SAVE_REQUEST);}catch(ActivityNotFoundException e){clearSave();message("没有可用的文件保存应用。");}
    }
    private void clearSave() {saveUrl=null;saveCookie=null;saveMime=null;}
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==FILE_REQUEST&&fileCallback!=null){
            Uri[] selected=result==RESULT_OK?WebChromeClient.FileChooserParams.parseResult(result,data):null;
            if(selected!=null)for(Uri uri:selected)if(uri==null||!"content".equalsIgnoreCase(uri.getScheme())){selected=null;message("请选择系统文件应用提供的文件。");break;}
            fileCallback.onReceiveValue(selected);fileCallback=null;
        }
        if(request==SAVE_REQUEST&&saveUrl!=null){
            if(result!=RESULT_OK||data==null||data.getData()==null){clearSave();return;}
            final Uri target=data.getData();final String url=saveUrl,cookie=saveCookie,mime=saveMime;clearSave();
            if(!"content".equalsIgnoreCase(target.getScheme())){message("文件保存位置无效。");return;}
            message("正在保存文件…");
            downloads.execute(()->{HttpURLConnection connection=null;boolean success=false;try{
                connection=(HttpURLConnection)new URL(url).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
                if(cookie!=null)connection.setRequestProperty("Cookie",cookie);
                int status=connection.getResponseCode();if(status!=200)throw new Exception(status==401?"登录已过期，请重新登录后下载。":"下载失败，请稍后重试。");
                try(InputStream in=connection.getInputStream();OutputStream out=getContentResolver().openOutputStream(target,"wt")){if(out==null)throw new Exception("无法写入所选文件位置。");byte[] bytes=new byte[16384];int n;long total=0;while((n=in.read(bytes))!=-1){total+=n;if(total>32*1024*1024)throw new Exception("文件超过32MB，请使用网页版下载。");out.write(bytes,0,n);}}
                success=true;runOnUiThread(()->{message("文件已保存到所选位置。");});
            }catch(Exception e){String text=e.getMessage();runOnUiThread(()->message(text!=null&&text.startsWith("登录")?text:"文件保存失败，请检查网络或保存位置后重试。"));}
            finally{if(connection!=null)connection.disconnect();if(!success)try{android.provider.DocumentsContract.deleteDocument(getContentResolver(),target);}catch(Exception ignored){}}
            });
        }
    }
}
