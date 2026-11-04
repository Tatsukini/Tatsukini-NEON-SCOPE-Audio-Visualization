using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace NeonScope;

/// <summary>
/// Loopback-only Kestrel server. Serves the embedded web UI and provides the
/// two native endpoints the frontend needs: FFmpeg health and MP4 conversion.
/// </summary>
internal sealed class ServerHost : IAsyncDisposable
{
    private WebApplication? _app;
    private readonly string _webRoot;
    private readonly string _tempRoot;
    private readonly IFileProvider _fileProvider;

    public string BaseUrl { get; private set; } = string.Empty;
    public string? FfmpegPath { get; private set; }
    public string FfmpegVersion { get; private set; } = string.Empty;

    public ServerHost()
    {
        AppPaths.EnsureDirectories();
        _webRoot = AppPaths.WebRoot;
        _tempRoot = AppPaths.TempRoot;
        _fileProvider = new PhysicalFileProvider(_webRoot);
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await ExtractWebAssetsAsync();
        CleanupOldJobs();
        DetectFfmpeg();

        var port = FindFreePort();
        BaseUrl = $"http://127.0.0.1:{port}/";

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = Array.Empty<string>(),
            ContentRootPath = AppContext.BaseDirectory,
            EnvironmentName = Environments.Production,
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, port);
            options.AddServerHeader = false;
            options.Limits.MaxRequestBodySize = 3L * 1024 * 1024 * 1024;
            options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
        });

        var app = builder.Build();

        app.MapGet("/api/health", () => Results.Json(new
        {
            ffmpeg = FfmpegPath != null,
            version = FfmpegVersion,
            platform = "win32",
        }));

        app.MapPost("/api/convert", (Delegate)HandleConvertAsync)
            .DisableAntiforgery();

        app.MapPost("/api/save-archive", async (HttpRequest request, string? filename, string? folder) =>
        {
            try
            {
                var targetFolder = string.IsNullOrWhiteSpace(folder)
                    ? Path.Combine(AppPaths.Root, "Saves")
                    : folder;
                Directory.CreateDirectory(targetFolder);
                var safeName = Path.GetFileName(string.IsNullOrWhiteSpace(filename) ? "neon-scope.NEON" : filename);
                if (string.IsNullOrWhiteSpace(safeName)) safeName = "neon-scope.NEON";
                var target = Path.Combine(targetFolder, safeName);
                await using (var stream = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    await request.Body.CopyToAsync(stream);
                }
                return Results.Json(new { ok = true, path = target });
            }
            catch (Exception ex)
            {
                AppPaths.Log("HTTP archive save failed: " + ex.Message);
                return Results.Json(new { ok = false, message = ex.Message }, statusCode: 500);
            }
        }).DisableAntiforgery();

        var defaultFiles = new DefaultFilesOptions { FileProvider = _fileProvider };
        defaultFiles.DefaultFileNames.Clear();
        defaultFiles.DefaultFileNames.Add("index.html");
        app.UseDefaultFiles(defaultFiles);
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = _fileProvider,
            ServeUnknownFileTypes = true,
            OnPrepareResponse = ctx =>
            {
                ctx.Context.Response.Headers.CacheControl = "no-cache";
            },
        });

        await app.StartAsync(cancellationToken);
        _app = app;
        AppPaths.Log($"Server started at {BaseUrl}");
        AppPaths.Log(FfmpegPath == null
            ? "FFmpeg not found. MP4 export will fall back to WebM."
            : $"FFmpeg: {FfmpegPath} ({FfmpegVersion})");
    }

    private async Task<IResult> HandleConvertAsync(HttpContext context)
    {
        if (!HttpMethods.IsPost(context.Request.Method))
        {
            return Results.StatusCode(StatusCodes.Status405MethodNotAllowed);
        }
        if (FfmpegPath == null)
        {
            return Results.Json(new { error = "未检测到 FFmpeg。请把 ffmpeg.exe 放在本程序同目录，或安装 FFmpeg 并加入 PATH。" },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var outputName = SanitizeFileName(context.Request.Headers["X-Output-Name"].FirstOrDefault());
        var crfHeader = context.Request.Headers["X-Video-CRF"].FirstOrDefault();
        var crf = 17;
        if (int.TryParse(crfHeader, out var parsedCrf)) crf = Math.Clamp(parsedCrf, 12, 30);

        var jobDir = Path.Combine(_tempRoot, "job-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(jobDir);
        var inputPath = Path.Combine(jobDir, "input.webm");
        var outputPath = Path.Combine(jobDir, "output.mp4");

        try
        {
            await using (var file = new FileStream(inputPath, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, true))
            {
                await context.Request.Body.CopyToAsync(file, context.RequestAborted);
            }

            var inputInfo = new FileInfo(inputPath);
            if (!inputInfo.Exists || inputInfo.Length < 1024)
            {
                TryDeleteDirectory(jobDir);
                return Results.Json(new { error = "上传的视频流为空或损坏。" },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var args = new List<string>
            {
                "-hide_banner", "-loglevel", "error", "-y",
                "-i", inputPath,
                "-map", "0:v:0", "-map", "0:a:0?",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264", "-preset", "medium", "-crf", crf.ToString(),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest", outputPath,
            };

            var psi = new ProcessStartInfo
            {
                FileName = FfmpegPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            foreach (var arg in args) psi.ArgumentList.Add(arg);

            using var process = Process.Start(psi);
            if (process == null)
            {
                TryDeleteDirectory(jobDir);
                return Results.Json(new { error = "无法启动 FFmpeg 进程。" },
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            var errorTask = process.StandardError.ReadToEndAsync();
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeoutCts.CancelAfter(TimeSpan.FromMinutes(15));
            try
            {
                await process.WaitForExitAsync(timeoutCts.Token);
            }
            catch
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                throw;
            }

            var errorText = await errorTask;
            if (process.ExitCode != 0 || !File.Exists(outputPath))
            {
                AppPaths.Log("FFmpeg failed: " + errorText);
                TryDeleteDirectory(jobDir);
                return Results.Json(new { error = "FFmpeg 转码失败。" + Shorten(errorText, 800) },
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            var outputInfo = new FileInfo(outputPath);
            AppPaths.Log($"MP4 ready: {outputName}.mp4 ({outputInfo.Length} bytes)");
            // Keep the file briefly: Results.File streams it after this handler
            // returns, and deleting the job directory immediately can truncate
            // the response in some clients.
            _ = Task.Run(async () =>
            {
                try { await Task.Delay(TimeSpan.FromMinutes(5)); }
                finally { TryDeleteDirectory(jobDir); }
            });

            var downloadName = outputName + ".mp4";
            return Results.File(outputPath, "video/mp4", downloadName);
        }
        catch (OperationCanceledException)
        {
            TryDeleteDirectory(jobDir);
            return Results.StatusCode(499);
        }
        catch (Exception ex)
        {
            AppPaths.Log("Convert error: " + ex);
            TryDeleteDirectory(jobDir);
            return Results.Json(new { error = "转码服务异常：" + ex.Message },
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private async Task ExtractWebAssetsAsync()
    {
        Directory.CreateDirectory(_webRoot);
        var assembly = Assembly.GetExecutingAssembly();
        foreach (var resourceName in assembly.GetManifestResourceNames())
        {
            if (!resourceName.StartsWith("web/", StringComparison.Ordinal)) continue;
            var relative = resourceName["web/".Length..].Replace('/', Path.DirectorySeparatorChar);
            var destination = Path.Combine(_webRoot, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            await using var source = assembly.GetManifestResourceStream(resourceName);
            if (source == null) continue;
            try
            {
                if (File.Exists(destination)) File.SetAttributes(destination, FileAttributes.Normal);
                await using var target = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.Read);
                await source.CopyToAsync(target);
            }
            catch (Exception ex) when ((ex is IOException || ex is UnauthorizedAccessException) && File.Exists(destination))
            {
                // A previous WebView2 process may still be serving the old file.
                // Keep the existing asset and continue starting the app.
                AppPaths.Log($"Web asset update skipped ({relative}): {ex.Message}");
            }
        }

        // Portable ZIP assets override the embedded copies. This keeps the
        // distribution editable without requiring a rebuild of the EXE.
        var externalAssets = Path.Combine(AppContext.BaseDirectory, "assets");
        if (Directory.Exists(externalAssets))
        {
            var targetAssets = Path.Combine(_webRoot, "assets");
            Directory.CreateDirectory(targetAssets);
            foreach (var file in Directory.EnumerateFiles(externalAssets, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(externalAssets, file);
                var destination = Path.Combine(targetAssets, relative);
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    if (File.Exists(destination)) File.SetAttributes(destination, FileAttributes.Normal);
                    File.Copy(file, destination, true);
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    AppPaths.Log($"External asset update skipped ({relative}): {ex.Message}");
                }
            }
        }
    }

    private static int FindFreePort()
    {
        // A stable loopback origin keeps localStorage (layout, accent,
        // settings) persistent between desktop-app launches.
        for (var port = 17321; port <= 17325; port++)
        {
            if (IsPortFree(port)) return port;
        }

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static bool IsPortFree(int port)
    {
        var listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start();
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            try { listener.Stop(); } catch { }
        }
    }

    private void DetectFfmpeg()
    {
        var candidates = new List<string>();
        var baseDir = AppContext.BaseDirectory;
        candidates.Add(Path.Combine(baseDir, "ffmpeg.exe"));
        candidates.Add(Path.Combine(baseDir, "resources", "ffmpeg.exe"));

        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                candidates.Add(Path.Combine(dir.Trim(), "ffmpeg.exe"));
                candidates.Add(Path.Combine(dir.Trim(), "ffmpeg"));
            }
            catch
            {
                // Ignore malformed PATH entries.
            }
        }

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(candidate)) continue;
            FfmpegPath = candidate;
            break;
        }

        if (FfmpegPath == null) return;

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = FfmpegPath,
                Arguments = "-version",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var process = Process.Start(psi);
            if (process == null) return;
            var firstLine = process.StandardOutput.ReadLine() ?? string.Empty;
            if (!process.WaitForExit(4000))
            {
                try { process.Kill(); } catch { }
                return;
            }
            FfmpegVersion = firstLine.Replace("ffmpeg version ", string.Empty, StringComparison.OrdinalIgnoreCase)
                .Trim();
            if (process.ExitCode != 0)
            {
                FfmpegPath = null;
                FfmpegVersion = string.Empty;
            }
        }
        catch
        {
            FfmpegPath = null;
            FfmpegVersion = string.Empty;
        }
    }

    private void CleanupOldJobs()
    {
        try
        {
            if (!Directory.Exists(_tempRoot)) return;
            foreach (var dir in Directory.GetDirectories(_tempRoot))
            {
                try
                {
                    if (Directory.GetLastWriteTimeUtc(dir) < DateTime.UtcNow.AddDays(-1))
                    {
                        Directory.Delete(dir, true);
                    }
                }
                catch { }
            }
        }
        catch { }
    }

    private static string SanitizeFileName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "neon-scope";
        string decoded;
        try { decoded = Uri.UnescapeDataString(value); }
        catch { decoded = value; }

        foreach (var c in Path.GetInvalidFileNameChars())
        {
            decoded = decoded.Replace(c, '-');
        }
        decoded = Regex.Replace(decoded, @"\s+", "-");
        decoded = decoded.Trim('-', '.', ' ');
        if (decoded.Length == 0) return "neon-scope";
        return decoded.Length > 80 ? decoded[..80] : decoded;
    }

    private static string Shorten(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        return text.Length <= max ? text : text[^max..];
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, true);
        }
        catch { }
    }

    public async ValueTask DisposeAsync()
    {
        if (_app == null) return;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await _app.StopAsync(cts.Token);
        }
        catch { }
        try
        {
            await _app.DisposeAsync();
        }
        catch { }
        _app = null;
    }
}
