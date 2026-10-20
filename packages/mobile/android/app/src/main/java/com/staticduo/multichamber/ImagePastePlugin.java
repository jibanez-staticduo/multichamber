package com.staticduo.multichamber;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.webkit.WebView;

/** Reports from the composer whether it accepts an image paste (see MultichamberWebView). */
@CapacitorPlugin(name = "ImagePaste")
public class ImagePastePlugin extends Plugin {

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        WebView webView = getBridge().getWebView();
        if (enabled == null || !(webView instanceof MultichamberWebView)) {
            call.reject("enabled is required and the WebView must be MultichamberWebView");
            return;
        }

        // Plugin methods are not on the main thread, and restartInput needs to be.
        getBridge().executeOnMainThread(() -> {
            boolean wasEnabled = ((MultichamberWebView) webView).setImagePasteEnabled(enabled);
            call.resolve();
            if (enabled && !wasEnabled) {
                ((MultichamberWebView) webView).restartInputConnection();
            }
        });
    }
}
