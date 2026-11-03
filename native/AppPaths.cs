using System;
using System.IO;

namespace NeonScope;

internal static class AppPaths
{
    public static string Root { get; } = ResolveRoot();

    public static string WebRoot => Path.Combine(Root, "web");
    public static string TempRoot => Path.Combine(Root, "temp");
    public static string WebViewData => Path.Combine(Root, "WebView2");
    public static string LogPath => Path.Combine(Root, "neon-scope.log");

    private static string ResolveRoot()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NEONScope"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "NEONScopeData"),
            Path.Combine(AppContext.BaseDirectory, "NEONScopeData"),
        };

        foreach (var candidate in candidates)
        {
            try
            {
                Directory.CreateDirectory(candidate);
                var probe = Path.Combine(candidate, ".write-probe");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return candidate;
            }
            catch
            {
                // Try the next writable location.
            }
        }

        // Last resort; the app will show a readable error if this is not writable.
        return Path.Combine(AppContext.BaseDirectory, "NEONScopeData");
    }

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(WebRoot);
        Directory.CreateDirectory(TempRoot);
        Directory.CreateDirectory(WebViewData);
    }

    public static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Root);
            var info = new FileInfo(LogPath);
            if (info.Exists && info.Length > 2 * 1024 * 1024)
            {
                File.WriteAllText(LogPath, string.Empty);
            }
            File.AppendAllText(LogPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never take the app down.
        }
    }
}
