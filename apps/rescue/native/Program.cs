using System.Diagnostics;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

namespace YutuRescue;
static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        System.Windows.Forms.Application.Run(new RescueWindow());
    }
}

sealed class RescueWindow : Form
{
    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(25, 30, 32) };
    readonly Label status = new() { Text = "正在连接独立救援服务…", Dock = DockStyle.Fill, ForeColor = Color.White, BackColor = Color.FromArgb(25, 30, 32), TextAlign = ContentAlignment.MiddleCenter };
    const string Origin = "http://127.0.0.1:48950";
    public RescueWindow()
    {
        Text = "玉兔 · 独立救援"; Width = 1100; Height = 820; MinimumSize = new Size(420, 560);
        Controls.Add(status); Controls.Add(web); web.Visible = false;
        Shown += async (_, _) => await Connect();
    }
    async Task Connect()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            bool ready = false;
            try { ready = (await client.GetStringAsync(Origin + "/health")).Contains("yutu-independent-rescue"); } catch { }
            if (!ready)
            {
                var home = AppContext.BaseDirectory;
                var node = Path.Combine(home, "runtime", "node.exe");
                var service = Path.Combine(home, "rescue-service.mjs");
                var config = Path.Combine(home, "private", "rescue.json");
                if (!File.Exists(node) || !File.Exists(service) || !File.Exists(config)) throw new InvalidOperationException("独立救援尚未安装完整。请从可信安装包补齐运行时、服务和独立配置；不会调用玉兔主程序兜底。");
                var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = home };
                start.ArgumentList.Add(service); start.ArgumentList.Add("--config"); start.ArgumentList.Add(config);
                Process.Start(start);
                for (int i = 0; i < 20 && !ready; i++) { await Task.Delay(500); try { ready = (await client.GetStringAsync(Origin + "/health")).Contains("yutu-independent-rescue"); } catch { } }
                if (!ready) throw new InvalidOperationException("独立救援服务未就绪。请从受控SSH维修通道核查；没有反复启动主程序。");
            }
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YutuRescue", "WebView2");
            await web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, profile));
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            web.CoreWebView2.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) || u.GetLeftPart(UriPartial.Authority) != Origin) e.Cancel = true; };
            web.CoreWebView2.DownloadStarting += (_, e) => e.Cancel = true;
            web.Source = new Uri(Origin); status.Visible = false; web.Visible = true;
        }
        catch (Exception e) { status.Text = e.Message; }
    }
}
