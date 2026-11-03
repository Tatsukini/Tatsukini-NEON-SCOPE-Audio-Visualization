using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace NeonScope;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        TryHideOwnConsole();

        // WinForms' visual-style activation and WebView2 both use %TEMP%.
        // Point them at our own writable data folder so the app also works on
        // machines with a locked-down or broken system temp directory.
        try
        {
            AppPaths.EnsureDirectories();
            Environment.SetEnvironmentVariable("TEMP", AppPaths.TempRoot);
            Environment.SetEnvironmentVariable("TMP", AppPaths.TempRoot);
        }
        catch { }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            Application.Run(new MainForm());
        }
        catch (Exception ex)
        {
            try { AppPaths.Log("Fatal: " + ex); } catch { }
            MessageBox.Show(
                "NEON//SCOPE 无法启动。\r\n\r\n" + ex.Message +
                "\r\n\r\n日志位置：\r\n" + AppPaths.LogPath,
                "NEON//SCOPE", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void TryHideOwnConsole()
    {
        try
        {
            var handle = GetConsoleWindow();
            if (handle == IntPtr.Zero) return;
            var processes = new int[4];
            var count = GetConsoleProcessList(processes, processes.Length);
            // When double-clicked, this process owns the console. Hide that
            // window. When launched from a terminal, leave the terminal alone.
            if (count <= 1) ShowWindow(handle, 0);
        }
        catch { }
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("kernel32.dll")]
    private static extern int GetConsoleProcessList(int[] processList, int processCount);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
