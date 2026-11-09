using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NeonScope;

internal sealed class SettingsForm : Form
{
    private readonly CoreWebView2Environment _environment;
    private readonly string _url;
    private WebView2? _webView;
    private Label? _splash;

    public event EventHandler<string>? SettingsChanged;

    public SettingsForm(CoreWebView2Environment environment, string baseUrl)
    {
        _environment = environment;
        _url = baseUrl.TrimEnd('/') + "/?settings=1";

        Text = "NEON//SCOPE — 设置";
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(8, 5, 13);
        ForeColor = Color.FromArgb(255, 79, 139);
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(820, 600);
        Size = new Size(1080, 780);
        ShowInTaskbar = true;
        Icon = LoadAppIcon();

        CreateSplash();
        Shown += async (_, _) => await StartAsync();
        FormClosed += (_, _) =>
        {
            _webView?.Dispose();
            _webView = null;
        };
        HandleCreated += (_, _) => TryEnableDarkTitleBar();
    }

    private void CreateSplash()
    {
        _splash = new Label
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(8, 5, 13),
            ForeColor = Color.FromArgb(255, 79, 139),
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 12f, FontStyle.Regular),
            Text = "NEON//SCOPE\r\n\r\n正在打开设置…",
        };
        Controls.Add(_splash);
    }

    private async Task StartAsync()
    {
        try
        {
            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(8, 5, 13),
            };
            Controls.Add(_webView);
            _webView.BringToFront();
            _splash?.BringToFront();

            await _webView.EnsureCoreWebView2Async(_environment);
            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsSwipeNavigationEnabled = false;
            core.WebMessageReceived += OnWebMessageReceived;
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            _webView.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess) return;
                if (_splash != null)
                {
                    Controls.Remove(_splash);
                    _splash.Dispose();
                    _splash = null;
                }
            };
            core.Navigate(_url);
            AppPaths.Log("Settings window navigating to " + _url);
        }
        catch (WebView2RuntimeNotFoundException ex)
        {
            AppPaths.Log("Settings WebView2 missing: " + ex.Message);
            MessageBox.Show(this,
                "当前系统没有安装 Microsoft Edge WebView2 Runtime。\r\n\r\n" +
                "请安装 WebView2 Runtime 后重新打开程序。",
                "NEON//SCOPE", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
        catch (Exception ex)
        {
            AppPaths.Log("Settings window failed: " + ex);
            MessageBox.Show(this, "无法打开设置窗口：\r\n" + ex.Message,
                "NEON//SCOPE", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            if (!doc.RootElement.TryGetProperty("action", out var actionElement)) return;
            var action = actionElement.GetString();
            if (action == "close-settings")
            {
                Close();
                return;
            }
            if (action == "choose-folder")
            {
                var kind = doc.RootElement.TryGetProperty("kind", out var kindElement) ? kindElement.GetString() : "save";
                using var dialog = new FolderBrowserDialog
                {
                    Description = kind == "export" ? "选择默认视频导出文件夹" : "选择默认工程存档文件夹",
                    UseDescriptionForTitle = true,
                    ShowNewFolderButton = true,
                };
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    PostJson(JsonSerializer.Serialize(new
                    {
                        action = "folder-chosen",
                        kind,
                        path = dialog.SelectedPath,
                    }));
                }
                return;
            }
            if (action == "open-external")
            {
                var url = doc.RootElement.TryGetProperty("url", out var urlElement) ? urlElement.GetString() : null;
                if (!string.IsNullOrWhiteSpace(url) && Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                {
                    try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
                    catch { /* external browser is optional */ }
                }
                return;
            }
            if (action == "open-folder")
            {
                OpenFolder(doc.RootElement);
                return;
            }
            if (action == "settings-updated" || action == "background-image" ||
                action == "save-archive" || action == "archive-import")
            {
                SettingsChanged?.Invoke(this, e.WebMessageAsJson);
            }
        }
        catch
        {
            // Ignore malformed bridge messages.
        }
    }

    private static void OpenFolder(JsonElement element)
    {
        var kind = element.TryGetProperty("kind", out var kindElement) ? kindElement.GetString() : "save";
        var path = element.TryGetProperty("path", out var pathElement) ? pathElement.GetString() : null;
        string? folder = null;
        if (!string.IsNullOrWhiteSpace(path))
        {
            var trimmed = path.Trim();
            if (Directory.Exists(trimmed)) folder = trimmed;
            else
            {
                try
                {
                    var current = Path.GetDirectoryName(trimmed);
                    while (!string.IsNullOrEmpty(current))
                    {
                        if (Directory.Exists(current)) { folder = current; break; }
                        current = Path.GetDirectoryName(current);
                    }
                }
                catch { /* fall through to defaults */ }
            }
        }
        folder ??= kind == "export"
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")
            : Path.Combine(AppPaths.Root, "Saves");
        if (!Directory.Exists(folder))
        {
            try { Directory.CreateDirectory(folder); } catch { folder = AppPaths.Root; }
        }
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                UseShellExecute = true,
                ArgumentList = { folder },
            });
        }
        catch { /* explorer is a convenience */ }
    }

    public void PostJson(string json)
    {
        try
        {
            _webView?.CoreWebView2?.PostWebMessageAsJson(json);
        }
        catch
        {
            // The settings window may be closing.
        }
    }

    private void TryEnableDarkTitleBar()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763)) return;
        try
        {
            var enabled = 1;
            var result = DwmSetWindowAttribute(Handle, 20, ref enabled, sizeof(int));
            if (result != 0) DwmSetWindowAttribute(Handle, 19, ref enabled, sizeof(int));
        }
        catch
        {
            // Cosmetic only.
        }
    }

    private static Icon? LoadAppIcon()
    {
        try
        {
            var path = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(path))
            {
                var icon = Icon.ExtractAssociatedIcon(path);
                if (icon != null) return icon;
            }
        }
        catch { }
        return null;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
