using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NeonScope;

internal sealed class MainForm : Form
{
    private readonly ServerHost _server = new();
    private readonly CancellationTokenSource _lifetime = new();
    private WebView2? _webView;
    private Label? _splash;
    private CoreWebView2Environment? _environment;
    private SettingsForm? _settingsForm;
    private StageForm? _stageForm;
    private string _saveFolder = string.Empty;
    private string _exportFolder = string.Empty;
    private bool _closing;
    private bool _allowClose;

    public MainForm()
    {
        Text = "NEON//SCOPE";
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(7, 5, 10);
        ForeColor = Color.FromArgb(255, 79, 139);
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(1120, 700);
        Icon = LoadAppIcon();

        var work = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1600, 1000);
        Width = Math.Min(1600, Math.Max(1120, work.Width - 48));
        Height = Math.Min(1000, Math.Max(700, work.Height - 48));

        LoadPathSettings();
        CreateSplash();
        Shown += async (_, _) => await StartAsync();
        FormClosing += OnFormClosing;
        HandleCreated += OnHandleCreated;
    }

    private void CreateSplash()
    {
        _splash = new Label
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(7, 5, 10),
            ForeColor = Color.FromArgb(255, 79, 139),
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 12f, FontStyle.Regular),
            Text = "NEON//SCOPE\r\n\r\n正在启动音频可视化引擎…",
        };
        Controls.Add(_splash);
    }

    private async Task StartAsync()
    {
        try
        {
            AppPaths.Log("Application starting.");
            _splash!.Text = "NEON//SCOPE\r\n\r\n正在启动本地渲染服务…";
            await _server.StartAsync(_lifetime.Token);

            _splash.Text = "NEON//SCOPE\r\n\r\n正在准备 WebView2 窗口…";
            _environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: AppPaths.WebViewData,
                options: null);

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(7, 5, 10),
            };
            Controls.Add(_webView);
            _webView.BringToFront();
            _splash.BringToFront();

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

            core.DownloadStarting += OnDownloadStarting;
            core.NewWindowRequested += OnNewWindowRequested;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.ProcessFailed += OnProcessFailed;
            core.WebMessageReceived += OnWebMessageReceived;
            _webView.NavigationCompleted += OnNavigationCompleted;

            core.Navigate(_server.BaseUrl);
            Text = "NEON//SCOPE — Audio Visualizer";
            AppPaths.Log($"WebView2 navigating to {_server.BaseUrl}");
        }
        catch (WebView2RuntimeNotFoundException ex)
        {
            AppPaths.Log("WebView2 Runtime missing: " + ex.Message);
            ShowFatal("当前系统没有安装 Microsoft Edge WebView2 Runtime。\r\n\r\n" +
                      "请安装 WebView2 Runtime 后重新打开程序：\r\n" +
                      "https://developer.microsoft.com/microsoft-edge/webview2/");
        }
        catch (OperationCanceledException)
        {
            // The user closed the window while it was starting.
        }
        catch (Exception ex)
        {
            AppPaths.Log("Startup failed: " + ex);
            ShowFatal("启动失败：\r\n" + ex.Message +
                      "\r\n\r\n详细日志：\r\n" + AppPaths.LogPath);
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            if (_splash != null)
            {
                Controls.Remove(_splash);
                _splash.Dispose();
                _splash = null;
            }
            AppPaths.Log("WebView2 navigation completed.");
        }
        else
        {
            AppPaths.Log("Navigation failed: " + e.WebErrorStatus);
            ShowFatal("页面加载失败：" + e.WebErrorStatus +
                      "\r\n\r\n日志：\r\n" + AppPaths.LogPath);
        }
    }

    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        try
        {
            var downloads = string.IsNullOrWhiteSpace(_exportFolder)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")
                : _exportFolder;
            Directory.CreateDirectory(downloads);

            var suggested = string.IsNullOrWhiteSpace(e.ResultFilePath)
                ? string.Empty
                : Path.GetFileName(e.ResultFilePath);
            if (string.IsNullOrWhiteSpace(suggested) && e.DownloadOperation != null &&
                Uri.TryCreate(e.DownloadOperation.Uri, UriKind.Absolute, out var downloadUri))
            {
                suggested = Path.GetFileName(Uri.UnescapeDataString(downloadUri.AbsolutePath));
            }
            if (string.IsNullOrWhiteSpace(suggested)) suggested = "neon-scope-output.webm";
            var target = MakeUniquePath(downloads, suggested);
            e.ResultFilePath = target;
            e.Handled = true;

            if (e.DownloadOperation != null)
            {
                e.DownloadOperation.StateChanged += (_, _) =>
                {
                    if (e.DownloadOperation.State == CoreWebView2DownloadState.Completed)
                    {
                        AppPaths.Log("Download complete: " + target);
                    }
                };
            }
            AppPaths.Log("Download requested: " + suggested + " -> " + target);
        }
        catch (Exception ex)
        {
            AppPaths.Log("Download setup failed: " + ex);
        }
    }

    private static string MakeUniquePath(string folder, string fileName)
    {
        var stem = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);
        if (string.IsNullOrWhiteSpace(stem)) stem = "neon-scope-output";
        if (string.IsNullOrWhiteSpace(ext)) ext = ".webm";

        var candidate = Path.Combine(folder, stem + ext);
        var index = 1;
        while (File.Exists(candidate))
        {
            candidate = Path.Combine(folder, $"{stem} ({index}){ext}");
            index++;
        }
        return candidate;
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (string.IsNullOrWhiteSpace(e.Uri)) return;
        try
        {
            Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
        }
        catch
        {
            // External navigation is a convenience, not a requirement.
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            if (!doc.RootElement.TryGetProperty("action", out var actionElement)) return;
            switch (actionElement.GetString())
            {
                case "open-settings":
                    OpenSettingsWindow();
                    break;
                case "open-stage-window":
                    OpenStageWindow();
                    break;
                case "open-external":
                    if (doc.RootElement.TryGetProperty("url", out var urlElement))
                        OpenExternal(urlElement.GetString());
                    break;
                case "choose-folder":
                    ChooseFolder(doc.RootElement);
                    break;
                case "paths-updated":
                    ApplyPaths(doc.RootElement);
                    break;
                case "save-archive":
                    SaveArchive(doc.RootElement);
                    break;
                case "archive-import":
                    if (doc.RootElement.TryGetProperty("archive", out var archive))
                        PostToMain($"{{\"action\":\"archive-import\",\"archive\":{archive.GetRawText()}}}");
                    break;
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("Native bridge message failed: " + ex.Message);
        }
    }

    private static void OpenExternal(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { AppPaths.Log("Open external failed: " + ex.Message); }
    }

    private void OpenSettingsWindow()
    {
        try
        {
            if (_environment == null) return;
            if (_settingsForm != null && !_settingsForm.IsDisposed)
            {
                if (!_settingsForm.Visible) _settingsForm.Show();
                _settingsForm.Activate();
                _settingsForm.BringToFront();
                return;
            }
            var form = new SettingsForm(_environment, _server.BaseUrl);
            form.SettingsChanged += OnSettingsChanged;
            form.FormClosed += (_, _) => _settingsForm = null;
            _settingsForm = form;
            form.Show();
            form.Activate();
        }
        catch (Exception ex)
        {
            AppPaths.Log("Open settings window failed: " + ex);
        }
    }

    private string PathConfigFile => Path.Combine(AppPaths.Root, "paths.json");

    private void LoadPathSettings()
    {
        try
        {
            if (!File.Exists(PathConfigFile)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(PathConfigFile));
            if (doc.RootElement.TryGetProperty("savePath", out var save)) _saveFolder = save.GetString() ?? string.Empty;
            if (doc.RootElement.TryGetProperty("exportPath", out var export)) _exportFolder = export.GetString() ?? string.Empty;
        }
        catch (Exception ex)
        {
            AppPaths.Log("Loading path settings failed: " + ex.Message);
        }
    }

    private void SavePathSettings()
    {
        try
        {
            File.WriteAllText(PathConfigFile, JsonSerializer.Serialize(new
            {
                savePath = _saveFolder,
                exportPath = _exportFolder,
            }));
        }
        catch (Exception ex)
        {
            AppPaths.Log("Saving path settings failed: " + ex.Message);
        }
    }

    private void ApplyPaths(JsonElement root)
    {
        if (root.TryGetProperty("savePath", out var save)) _saveFolder = save.GetString() ?? string.Empty;
        if (root.TryGetProperty("exportPath", out var export)) _exportFolder = export.GetString() ?? string.Empty;
        SavePathSettings();
    }

    private void ChooseFolder(JsonElement root)
    {
        var kind = root.TryGetProperty("kind", out var kindElement) ? kindElement.GetString() : "save";
        using var dialog = new FolderBrowserDialog
        {
            Description = kind == "export" ? "选择默认视频导出文件夹" : "选择默认工程存档文件夹",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
        };
        var current = kind == "export" ? _exportFolder : _saveFolder;
        if (!string.IsNullOrWhiteSpace(current)) dialog.SelectedPath = current;
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            if (kind == "export") _exportFolder = dialog.SelectedPath;
            else _saveFolder = dialog.SelectedPath;
            SavePathSettings();
            var payload = JsonSerializer.Serialize(new
            {
                action = "folder-chosen",
                kind,
                path = dialog.SelectedPath,
            });
            PostToMain(payload);
            _settingsForm?.PostJson(payload);
        }
    }

    private void SaveArchive(JsonElement root)
    {
        try
        {
            var filename = root.TryGetProperty("filename", out var nameElement) ? nameElement.GetString() : null;
            var content = root.TryGetProperty("content", out var contentElement) ? contentElement.GetString() : null;
            var contentBase64 = root.TryGetProperty("contentBase64", out var base64Element) ? base64Element.GetString() : null;
            if (string.IsNullOrWhiteSpace(content) && string.IsNullOrWhiteSpace(contentBase64)) return;
            var folder = string.IsNullOrWhiteSpace(_saveFolder)
                ? Path.Combine(AppPaths.Root, "Saves")
                : _saveFolder;
            Directory.CreateDirectory(folder);
            if (string.IsNullOrWhiteSpace(filename)) filename = "neon-scope.neon";
            filename = Path.GetFileName(filename);
            var saveAs = root.TryGetProperty("saveAs", out var saveAsElement) && saveAsElement.ValueKind == JsonValueKind.True;
            string target;
            if (saveAs)
            {
                using var dialog = new SaveFileDialog
                {
                    Title = "另存工程存档",
                    Filter = "NEON//SCOPE 工程存档 (*.neon)|*.neon|JSON 文件 (*.json)|*.json",
                    FileName = filename,
                    InitialDirectory = folder,
                    AddExtension = true,
                    DefaultExt = "neon",
                };
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                target = dialog.FileName;
            }
            else
            {
                target = MakeUniquePath(folder, filename);
            }
            if (!string.IsNullOrWhiteSpace(contentBase64))
            {
                File.WriteAllBytes(target, Convert.FromBase64String(contentBase64));
            }
            else
            {
                File.WriteAllText(target, content, new System.Text.UTF8Encoding(false));
            }
            var payload = JsonSerializer.Serialize(new { action = "archive-saved", path = target });
            PostToMain(payload);
            _settingsForm?.PostJson(payload);
            AppPaths.Log("Archive saved: " + target);
        }
        catch (Exception ex)
        {
            AppPaths.Log("Save archive failed: " + ex.Message);
            PostToMain(JsonSerializer.Serialize(new { action = "archive-error", message = ex.Message }));
        }
    }

    private void PostToMain(string json)
    {
        try
        {
            _webView?.CoreWebView2?.PostWebMessageAsJson(json);
        }
        catch (Exception ex)
        {
            AppPaths.Log("Posting to main window failed: " + ex.Message);
        }
    }

    private void OpenStageWindow()
    {
        try
        {
            if (_environment == null) return;
            if (_stageForm != null && !_stageForm.IsDisposed)
            {
                if (!_stageForm.Visible) _stageForm.Show();
                _stageForm.Activate();
                _stageForm.BringToFront();
                return;
            }
            var form = new StageForm(_environment, _server.BaseUrl);
            form.FormClosed += (_, _) => _stageForm = null;
            _stageForm = form;
            form.Show();
            form.Activate();
        }
        catch (Exception ex)
        {
            AppPaths.Log("Open stage window failed: " + ex);
        }
    }

    private void OnSettingsChanged(object? sender, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("action", out var actionElement))
            {
                var action = actionElement.GetString();
                if (action == "save-archive")
                {
                    SaveArchive(doc.RootElement);
                    return;
                }
                if (action == "archive-import")
                {
                    if (doc.RootElement.TryGetProperty("archive", out var archive))
                        PostToMain($"{{\"action\":\"archive-import\",\"archive\":{archive.GetRawText()}}}");
                    return;
                }
            }
            if (doc.RootElement.TryGetProperty("settings", out var settings))
            {
                if (settings.TryGetProperty("savePath", out var save)) _saveFolder = save.GetString() ?? string.Empty;
                if (settings.TryGetProperty("exportPath", out var export)) _exportFolder = export.GetString() ?? string.Empty;
                SavePathSettings();
            }
            PostToMain(json);
        }
        catch (Exception ex)
        {
            AppPaths.Log("Applying settings to main window failed: " + ex);
        }
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        AppPaths.Log("WebView2 process failed: " + e.ProcessFailedKind);
    }

    private void OnHandleCreated(object? sender, EventArgs e)
    {
        TryEnableDarkTitleBar();
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
            // Dark title bar merely improves the frame; ignore failures.
        }
    }

    private void ShowFatal(string message)
    {
        _splash?.Hide();
        MessageBox.Show(this, message, "NEON//SCOPE", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
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

    private async void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowClose) return;
        e.Cancel = true;
        if (_closing) return;
        _closing = true;
        Text = "NEON//SCOPE — 正在关闭…";
        try
        {
            _lifetime.Cancel();
            if (_settingsForm != null && !_settingsForm.IsDisposed)
            {
                _settingsForm.Close();
                _settingsForm = null;
            }
            if (_stageForm != null && !_stageForm.IsDisposed)
            {
                _stageForm.Close();
                _stageForm = null;
            }
            if (_webView != null)
            {
                _webView.Dispose();
                _webView = null;
            }
            await _server.DisposeAsync();
        }
        catch (Exception ex)
        {
            AppPaths.Log("Shutdown error: " + ex);
        }
        finally
        {
            _allowClose = true;
            Close();
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
