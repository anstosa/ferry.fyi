# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Capacitor reads plugin and permission declarations through reflection at
# runtime. Preserve their annotation metadata in minified release builds.
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault

# R8 must also retain Capacitor's cached plugin annotation and the methods that
# consume it. Otherwise it can inline a null result into permission requests.
-keepclassmembers class com.getcapacitor.PluginHandle {
    com.getcapacitor.annotation.CapacitorPlugin pluginAnnotation;
    com.getcapacitor.annotation.CapacitorPlugin getPluginAnnotation();
}
-keepclassmembers class com.getcapacitor.Plugin {
    java.util.Map getPermissionStates();
}

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
