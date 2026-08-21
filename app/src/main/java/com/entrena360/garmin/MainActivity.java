package com.entrena360.garmin;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.ComponentActivity;

public class MainActivity extends ComponentActivity {

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private HealthSyncBridge healthSyncBridge;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        healthSyncBridge = new HealthSyncBridge(this, webView);
        webView.addJavascriptInterface(healthSyncBridge, "EntrenaHealth");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectHealthConnectUi();
                if (healthSyncBridge != null) healthSyncBridge.autoSyncIfPossible();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (MainActivity.this.filePathCallback != null) MainActivity.this.filePathCallback.onReceiveValue(null);
                MainActivity.this.filePathCallback = callback;
                Intent intent = params.createIntent();
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream","application/xml","text/xml","text/csv","text/plain"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(intent, FILE_CHOOSER_REQUEST); }
                catch (Exception e) { MainActivity.this.filePathCallback = null; return false; }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void injectHealthConnectUi() {
        String js = "(function(){if(document.getElementById('garminSync'))return;" +
                "var link=document.createElement('link');link.rel='stylesheet';link.href='health-connect.css';document.head.appendChild(link);" +
                "var s=document.createElement('section');s.id='garminSync';s.className='card health-card';" +
                "s.innerHTML=\"<div class='health-head'><div class='health-title'><div class='health-icon'>⌚</div><div><div class='status-row'><span id='healthConnectDot' class='dot medium'></span><strong id='healthConnectStatus'>Comprobando conexión</strong></div><h2>Sincronización automática Garmin</h2><p id='healthConnectDetail'>Preparando Health Connect…</p></div></div><div class='health-actions'><button id='healthConnectBtn' class='primary'>Conectar</button><button id='healthSyncBtn' class='ghost'>Sincronizar ahora</button></div></div><div class='health-meta'><div><span>Última sincronización</span><strong id='healthLastSync'>—</strong></div><div><span>Pasos hoy</span><strong id='healthSteps'>—</strong></div><div><span>Fuente</span><strong>Garmin → Health Connect</strong></div></div><div class='health-explain'>Después de autorizar una vez, Entrena360 comprueba datos nuevos al abrir o volver a la app. Garmin Connect debe haber sincronizado primero el reloj.</div>\";" +
                "var main=document.querySelector('main');var info=main&&main.querySelector('.info');if(main){if(info)main.insertBefore(s,info);else main.appendChild(s);}" +
                "var sc=document.createElement('script');sc.src='health-connect.js';document.body.appendChild(sc);})();";
        webView.evaluateJavascript(js, null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (healthSyncBridge != null) healthSyncBridge.autoSyncIfPossible();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
