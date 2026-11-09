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
    private readonly HashSet<string> _encoders = new(StringComparer.OrdinalIgnoreCase);

    private static readonly Dictionary<string, string> ContainerTypes = new()
    {
        ["mp4"] = "video/mp4",
        ["mkv"] = "video/x-matroska",
        ["mov"] = "video/quicktime",
        ["webm"] = "video/webm",
    };

    private static readonly HashSet<string> X264Presets = new(StringComparer.OrdinalIgnoreCase)
    {
        "ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow",
    };

    private static readonly Dictionary<string, int> VpxSpeed = new()
    {
        ["ultrafast"] = 8, ["fast"] = 6, ["medium"] = 4, ["slow"] = 2, ["veryslow"] = 1,
    };

    private static readonly Dictionary<string, int> SvtPreset = new()
    {
        ["ultrafast"] = 12, ["fast"] = 8, ["medium"] = 6, ["slow"] = 4, ["veryslow"] = 3,
    };

    private static readonly Dictionary<string, int> CrfDefault = new()
    {
        ["h264"] = 20, ["h265"] = 24, ["vp9"] = 32, ["vp8"] = 28, ["av1"] = 30,
    };

    private static readonly Dictionary<string, int> CrfMax = new()
    {
        ["h264"] = 51, ["h265"] = 51, ["vp9"] = 63, ["vp8"] = 63, ["av1"] = 63,
    };

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
            codecs = AvailableVideoCodecs(),
            audioCodecs = AvailableAudioCodecs(),
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
        var container = OneOf(context.Request.Headers["X-Container"].FirstOrDefault(), ContainerTypes.Keys, "mp4");
        var codec = OneOf(context.Request.Headers["X-Codec"].FirstOrDefault(), new[] { "h264", "h265", "av1", "vp9", "vp8" }, "h264");
        var encoder = EncoderFor(codec);
        if (encoder == null)
        {
            return Results.Json(new { error = $"当前 FFmpeg 不支持 {codec.ToUpperInvariant()} 编码，请改用其他编码或更新 FFmpeg。" },
                statusCode: StatusCodes.Status400BadRequest);
        }

        var crf = CrfDefault.GetValueOrDefault(codec, 20);
        if (int.TryParse(context.Request.Headers["X-Video-CRF"].FirstOrDefault(), out var parsedCrf))
        {
            crf = Math.Clamp(parsedCrf, 0, CrfMax.GetValueOrDefault(codec, 51));
        }

        var preset = context.Request.Headers["X-Preset"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(preset) || !X264Presets.Contains(preset)) preset = "medium";

        var fps = 60;
        if (int.TryParse(context.Request.Headers["X-Fps"].FirstOrDefault(), out var parsedFps))
        {
            fps = Math.Clamp(parsedFps, 1, 240);
        }
        var gopSeconds = 2.0;
        if (double.TryParse(context.Request.Headers["X-Gop"].FirstOrDefault(),
                System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsedGop))
        {
            gopSeconds = Math.Clamp(parsedGop, 0.5, 10.0);
        }
        var gopFrames = Math.Max(1, (int)Math.Round(gopSeconds * fps));

        var sampleRate = context.Request.Headers["X-Sample-Rate"].FirstOrDefault() == "44100" ? 44100 : 48000;
        var audioBitrate = 192;
        if (int.TryParse(context.Request.Headers["X-Audio-Bitrate"].FirstOrDefault(), out var parsedAudioBitrate))
        {
            audioBitrate = Math.Clamp(parsedAudioBitrate, 64, 512);
        }
        var audioCodec = OneOf(context.Request.Headers["X-Audio-Codec"].FirstOrDefault(),
            new[] { "aac", "opus" }, container == "webm" ? "opus" : "aac");
        if (container == "webm") audioCodec = "opus";
        if (container == "mp4" || container == "mov") audioCodec = "aac";
        var audioEncoder = audioCodec == "opus"
            ? (_encoders.Count == 0 || _encoders.Contains("libopus") ? "libopus"
                : _encoders.Contains("opus") ? "opus" : null)
            : "aac";
        if (audioEncoder == null)
        {
            return Results.Json(new { error = "当前 FFmpeg 不支持 OPUS 编码，无法封装 WebM。" },
                statusCode: StatusCodes.Status400BadRequest);
        }

        var jobDir = Path.Combine(_tempRoot, "job-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(jobDir);
        var inputPath = Path.Combine(jobDir, "input.webm");
        var outputPath = Path.Combine(jobDir, "output." + container);

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
            };

            if (encoder == "libx264" || encoder == "libx265")
            {
                args.AddRange(new[] { "-c:v", encoder, "-preset", preset, "-crf", crf.ToString() });
                if (encoder == "libx265") args.AddRange(new[] { "-tag:v", "hvc1" });
            }
            else if (encoder == "libsvtav1")
            {
                args.AddRange(new[] { "-c:v", "libsvtav1", "-preset", SvtPreset.GetValueOrDefault(preset, 6).ToString(), "-crf", crf.ToString() });
            }
            else if (encoder == "libaom-av1")
            {
                args.AddRange(new[] { "-c:v", "libaom-av1", "-cpu-used", "6", "-row-mt", "1", "-crf", crf.ToString(), "-b:v", "0" });
            }
            else
            {
                args.AddRange(new[]
                {
                    "-c:v", encoder, "-crf", crf.ToString(), "-b:v", "0",
                    "-cpu-used", VpxSpeed.GetValueOrDefault(preset, 4).ToString(), "-row-mt", "1",
                });
            }

            args.AddRange(new[] { "-pix_fmt", "yuv420p", "-g", gopFrames.ToString() });
            if (container == "mp4" || container == "mov") args.AddRange(new[] { "-movflags", "+faststart" });
            args.AddRange(new[] { "-c:a", audioEncoder, "-b:a", $"{audioBitrate}k" });
            args.AddRange(new[] { "-ar", audioCodec == "opus" ? "48000" : sampleRate.ToString() });
            args.AddRange(new[] { "-shortest", outputPath });

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
            AppPaths.Log($"{container.ToUpperInvariant()} ready: {outputName}.{container} ({outputInfo.Length} bytes, {codec})");
            // Keep the file briefly: Results.File streams it after this handler
            // returns, and deleting the job directory immediately can truncate
            // the response in some clients.
            _ = Task.Run(async () =>
            {
                try { await Task.Delay(TimeSpan.FromMinutes(5)); }
                finally { TryDeleteDirectory(jobDir); }
            });

            var downloadName = $"{outputName}.{container}";
            return Results.File(outputPath, ContainerTypes[container], downloadName);
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

        if (FfmpegPath != null) DetectEncoders();
    }

    private void DetectEncoders()
    {
        _encoders.Clear();
        if (FfmpegPath == null) return;
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = FfmpegPath,
                Arguments = "-hide_banner -encoders",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var process = Process.Start(psi);
            if (process == null) return;
            var text = process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(5000))
            {
                try { process.Kill(); } catch { }
                return;
            }
            foreach (var line in text.Split('\n'))
            {
                var match = Regex.Match(line.TrimEnd('\r'), @"^\s*[VAS][A-Z.]{5}\s+(\S+)");
                if (match.Success) _encoders.Add(match.Groups[1].Value);
            }
        }
        catch
        {
            _encoders.Clear();
        }
    }

    private List<string> AvailableVideoCodecs()
    {
        var codecs = new List<string>();
        if (_encoders.Contains("libx264")) codecs.Add("h264");
        if (_encoders.Contains("libx265")) codecs.Add("h265");
        if (_encoders.Contains("libvpx-vp9")) codecs.Add("vp9");
        if (_encoders.Contains("libvpx")) codecs.Add("vp8");
        if (_encoders.Contains("libsvtav1") || _encoders.Contains("libaom-av1")) codecs.Add("av1");
        return codecs;
    }

    private List<string> AvailableAudioCodecs()
    {
        var codecs = new List<string>();
        if (_encoders.Contains("aac")) codecs.Add("aac");
        if (_encoders.Contains("libopus") || _encoders.Contains("opus")) codecs.Add("opus");
        return codecs;
    }

    private string? EncoderFor(string codec)
    {
        if (_encoders.Count == 0)
        {
            // Encoder probing failed but FFmpeg exists; let FFmpeg report real errors.
            return codec switch
            {
                "h264" => "libx264",
                "h265" => "libx265",
                "av1" => "libsvtav1",
                "vp9" => "libvpx-vp9",
                "vp8" => "libvpx",
                _ => null,
            };
        }
        return codec switch
        {
            "h264" => _encoders.Contains("libx264") ? "libx264" : null,
            "h265" => _encoders.Contains("libx265") ? "libx265" : null,
            "vp9" => _encoders.Contains("libvpx-vp9") ? "libvpx-vp9" : null,
            "vp8" => _encoders.Contains("libvpx") ? "libvpx" : null,
            "av1" => _encoders.Contains("libsvtav1") ? "libsvtav1"
                : _encoders.Contains("libaom-av1") ? "libaom-av1" : null,
            _ => null,
        };
    }

    private static string OneOf(string? value, IEnumerable<string> allowed, string fallback)
    {
        return !string.IsNullOrWhiteSpace(value) && allowed.Contains(value) ? value : fallback;
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
