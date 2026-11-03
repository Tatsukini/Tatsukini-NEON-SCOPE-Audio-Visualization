using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NeonScope;

internal sealed class StageForm : Form
{
    private readonly CoreWebView2Environment _environment;
    private readonly string _url;
    private WebView2? _webView;
    private Label? _splash;

    public StageForm(CoreWebView2Environment environment, string baseUrl)
    {
        _environment = environment;
        _url = baseUrl.TrimEnd('/') + "/?stage=1";

        Text = "NEON//SCOPE — 独立舞台";
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.Black;
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(640, 360);
        Size = new Size(1280, 720);
        ShowInTaskbar = true;
        Icon = LoadAppIcon();

        _splash = new Label
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
            ForeColor = Color.FromArgb(255, 79, 139),
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 12f),
            Text = "NEON//SCOPE\r\n\r\n正在打开独立舞台…",
        };
        Controls.Add(_splash);
        Shown += async (_, _) => await StartAsync();
        FormClosed += (_, _) =>
        {
            _webView?.Dispose();
            _webView = null;
        };
        HandleCreated += (_, _) => TryEnableDarkTitleBar();
    }

    private async Task StartAsync()
    {
        try
        {
            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.Black,
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
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            _webView.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess || _splash == null) return;
                Controls.Remove(_splash);
                _splash.Dispose();
                _splash = null;
            };
            core.Navigate(_url);
            AppPaths.Log("Stage window navigating to " + _url);
        }
        catch (Exception ex)
        {
            AppPaths.Log("Stage window failed: " + ex.Message);
            MessageBox.Show(this, "无法打开独立舞台：\r\n" + ex.Message,
                "NEON//SCOPE", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
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
        catch { }
    }

    private static Icon? LoadAppIcon()
    {
        try
        {
            var path = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(path)) return Icon.ExtractAssociatedIcon(path);
        }
        catch { }
        return null;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
