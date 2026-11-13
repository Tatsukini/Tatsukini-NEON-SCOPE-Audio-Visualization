using System;
using System.Drawing;
using System.Windows.Forms;

namespace NeonScope;

internal enum CloseChoice
{
    None,
    Tray,
    Exit,
}

internal sealed class CloseConfirmForm : Form
{
    public CloseChoice Choice { get; private set; } = CloseChoice.None;
    public bool Remember { get; private set; }

    private readonly CheckBox _remember;

    public CloseConfirmForm()
    {
        Text = "关闭 NEON//SCOPE";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(460, 230);
        BackColor = Color.FromArgb(10, 7, 16);
        ForeColor = Color.FromArgb(247, 238, 243);
        Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);

        var title = new Label
        {
            Text = "关闭窗口",
            Location = new Point(28, 20),
            Size = new Size(400, 30),
            ForeColor = Color.FromArgb(255, 79, 139),
            Font = new Font("Microsoft YaHei UI", 13f, FontStyle.Bold),
        };

        var body = new Label
        {
            Text = "请选择关闭方式。最小化到托盘会保持播放与自动存档继续运行；直接关闭会结束程序。",
            Location = new Point(28, 56),
            Size = new Size(404, 54),
            ForeColor = Color.FromArgb(178, 168, 186),
        };

        _remember = new CheckBox
        {
            Text = "不再询问，记住我的选择",
            Location = new Point(28, 116),
            Size = new Size(320, 24),
            ForeColor = Color.FromArgb(214, 205, 220),
            BackColor = Color.Transparent,
        };

        var tray = new Button
        {
            Text = "最小化到托盘",
            Location = new Point(28, 160),
            Size = new Size(170, 40),
        };
        StyleButton(tray, primary: true);
        tray.Click += (_, _) =>
        {
            Choice = CloseChoice.Tray;
            Remember = _remember.Checked;
            DialogResult = DialogResult.OK;
            Close();
        };

        var exit = new Button
        {
            Text = "直接关闭",
            Location = new Point(210, 160),
            Size = new Size(120, 40),
        };
        StyleButton(exit, primary: false);
        exit.Click += (_, _) =>
        {
            Choice = CloseChoice.Exit;
            Remember = _remember.Checked;
            DialogResult = DialogResult.OK;
            Close();
        };

        var cancel = new Button
        {
            Text = "取消",
            Location = new Point(342, 160),
            Size = new Size(90, 40),
            DialogResult = DialogResult.Cancel,
        };
        StyleButton(cancel, primary: false);

        Controls.AddRange(new Control[] { title, body, _remember, tray, exit, cancel });
        CancelButton = cancel;
        AcceptButton = null;
    }

    private static void StyleButton(Button button, bool primary)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = primary
            ? Color.FromArgb(255, 79, 139)
            : Color.FromArgb(70, 58, 82);
        button.BackColor = primary
            ? Color.FromArgb(48, 18, 36)
            : Color.FromArgb(22, 16, 30);
        button.ForeColor = primary
            ? Color.FromArgb(255, 190, 214)
            : Color.FromArgb(220, 210, 224);
        button.Cursor = Cursors.Hand;
    }
}
