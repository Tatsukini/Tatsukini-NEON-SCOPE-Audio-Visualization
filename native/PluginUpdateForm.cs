// Copyright (C) 2026 Tatsukini
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace NeonScope;

internal sealed record PluginUpdateItem(string Id, string Name, string CurrentVersion, string LatestVersion, string Note)
{
    public string Display =>
        $"{Name}    v{CurrentVersion} → v{LatestVersion}" +
        (string.IsNullOrWhiteSpace(Note) ? "" : $"（{Note}）");

    public override string ToString() => Display;
}

internal sealed class PluginUpdateForm : Form
{
    private readonly CheckedListBox _list;
    private readonly Button _updateButton;

    public IReadOnlyList<string> SelectedIds { get; private set; } = Array.Empty<string>();

    public PluginUpdateForm(IReadOnlyList<PluginUpdateItem> items)
    {
        Text = "插件更新";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(600, 400);
        MinimumSize = new Size(600, 400);
        BackColor = Color.FromArgb(10, 7, 16);
        ForeColor = Color.FromArgb(232, 219, 233);
        Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular);
        Icon = LoadIcon();

        var header = new Panel
        {
            Dock = DockStyle.Fill,
            Margin = Padding.Empty,
            BackColor = Color.FromArgb(15, 10, 24),
        };
        header.Controls.Add(new Label
        {
            Text = $"发现 {items.Count} 个插件更新",
            AutoSize = true,
            Location = new Point(16, 9),
            Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Bold),
            ForeColor = Color.FromArgb(255, 79, 139),
        });
        header.Controls.Add(new Label
        {
            Text = "勾选要更新的插件；更新会替换插件代码并立即重新加载。",
            AutoSize = true,
            Location = new Point(16, 34),
            ForeColor = Color.FromArgb(150, 136, 158),
        });

        _list = new CheckedListBox
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(12, 8, 12, 8),
            CheckOnClick = true,
            IntegralHeight = false,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(18, 12, 26),
            ForeColor = Color.FromArgb(232, 219, 233),
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular),
        };
        _list.Format += (_, e) =>
        {
            if (e.ListItem is PluginUpdateItem item) e.Value = item.Display;
        };
        foreach (var item in items) _list.Items.Add(item, true);

        var footer = new Panel
        {
            Dock = DockStyle.Fill,
            Margin = Padding.Empty,
            BackColor = Color.FromArgb(15, 10, 24),
        };
        var selectAll = MakeButton("全选");
        selectAll.Location = new Point(16, 13);
        selectAll.Click += (_, _) =>
        {
            for (var i = 0; i < _list.Items.Count; i += 1) _list.SetItemChecked(i, true);
        };
        var clearAll = MakeButton("全不选");
        clearAll.Location = new Point(104, 13);
        clearAll.Click += (_, _) =>
        {
            for (var i = 0; i < _list.Items.Count; i += 1) _list.SetItemChecked(i, false);
        };

        _updateButton = MakeButton("更新选中", true);
        _updateButton.Click += (_, _) =>
        {
            SelectedIds = _list.CheckedItems.Cast<PluginUpdateItem>().Select((item) => item.Id).ToArray();
            DialogResult = DialogResult.OK;
        };
        var cancel = MakeButton("取消");
        cancel.Click += (_, _) => DialogResult = DialogResult.Cancel;

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            AutoSize = true,
            WrapContents = false,
            FlowDirection = FlowDirection.LeftToRight,
            Padding = new Padding(0, 13, 16, 0),
            Margin = Padding.Empty,
        };
        actions.Controls.Add(_updateButton);
        actions.Controls.Add(cancel);
        footer.Controls.Add(actions);
        footer.Controls.Add(selectAll);
        footer.Controls.Add(clearAll);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
            BackColor = Color.FromArgb(10, 7, 16),
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 60f));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 58f));
        layout.Controls.Add(header, 0, 0);
        layout.Controls.Add(_list, 0, 1);
        layout.Controls.Add(footer, 0, 2);
        Controls.Add(layout);

        _list.ItemCheck += (_, _) => BeginInvoke(new Action(() => _updateButton.Enabled = _list.CheckedItems.Count > 0));
        AcceptButton = _updateButton;
        CancelButton = cancel;
    }

    private static Button MakeButton(string text, bool accent = false)
    {
        var button = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(24, 16, 33),
            ForeColor = accent ? Color.FromArgb(255, 120, 168) : Color.FromArgb(226, 214, 230),
            Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular),
            Size = new Size(88, 30),
            Margin = new Padding(8, 0, 0, 0),
            UseVisualStyleBackColor = false,
        };
        button.FlatAppearance.BorderColor = accent ? Color.FromArgb(198, 58, 108) : Color.FromArgb(58, 43, 72);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(46, 24, 52);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(64, 26, 62);
        return button;
    }

    private static Icon? LoadIcon()
    {
        try
        {
            var path = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(path)) return Icon.ExtractAssociatedIcon(path);
        }
        catch { }
        return null;
    }
}
