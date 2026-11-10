using System.Collections.Concurrent;
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
    private readonly HashSet<string> _hwVendors = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, ConvertLogJob> _convertJobs = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, Process> _convertProcs = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, (string Path, DateTime At)> _audioSources = new(StringComparer.OrdinalIgnoreCase);

    private sealed class ConvertLogJob
    {
        private readonly List<string> _lines = new();
        public bool Done;
        public bool Cancelled;
        public string? Error;
        public DateTime UpdatedAt = DateTime.UtcNow;

        public void Push(string text)
        {
            lock (_lines)
            {
                foreach (var part in text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var line = part.Trim();
                    if (line.Length == 0) continue;
                    _lines.Add(line);
                }
                if (_lines.Count > 220) _lines.RemoveRange(0, _lines.Count - 220);
            }
            UpdatedAt = DateTime.UtcNow;
        }

        public void Reset()
        {
            lock (_lines) _lines.Clear();
            UpdatedAt = DateTime.UtcNow;
        }

        public string[] Snapshot()
        {
            lock (_lines) return _lines.ToArray();
        }
    }

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

    private static readonly Dictionary<string, Dictionary<string, string>> HwEncoders = new()
    {
        ["nvidia"] = new() { ["h264"] = "h264_nvenc", ["h265"] = "hevc_nvenc", ["av1"] = "av1_nvenc" },
        ["amd"] = new() { ["h264"] = "h264_amf", ["h265"] = "hevc_amf", ["av1"] = "av1_amf" },
        ["intel"] = new() { ["h264"] = "h264_qsv", ["h265"] = "hevc_qsv", ["av1"] = "av1_qsv" },
    };

    private static readonly Dictionary<string, string> SoftwareEncoders = new()
    {
        ["h264"] = "libx264", ["h265"] = "libx265", ["vp9"] = "libvpx-vp9", ["vp8"] = "libvpx",
    };

    private static readonly Dictionary<string, int> NvencPreset = new()
    {
        ["ultrafast"] = 1, ["superfast"] = 2, ["veryfast"] = 3, ["faster"] = 4, ["fast"] = 4,
        ["medium"] = 5, ["slow"] = 6, ["slower"] = 7, ["veryslow"] = 7,
    };

    private static readonly Dictionary<string, string> AmfQuality = new()
    {
        ["ultrafast"] = "speed", ["superfast"] = "speed", ["veryfast"] = "speed",
        ["faster"] = "balanced", ["fast"] = "balanced", ["medium"] = "balanced",
        ["slow"] = "quality", ["slower"] = "quality", ["veryslow"] = "quality",
    };

    private static readonly Dictionary<string, string> QsvPreset = new()
    {
        ["ultrafast"] = "veryfast", ["superfast"] = "veryfast", ["veryfast"] = "veryfast",
        ["faster"] = "faster", ["fast"] = "fast", ["medium"] = "medium",
        ["slow"] = "slow", ["slower"] = "slower", ["veryslow"] = "veryslow",
    };

    private static readonly string[] EncoderVendors = { "auto", "software", "nvidia", "amd", "intel" };

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
            encoders = _encoders.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray(),
            hwVendors = _hwVendors.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray(),
        }));

        app.MapPost("/api/convert/cancel", (string? id) =>
        {
            var key = Regex.Replace(id ?? string.Empty, "[^A-Za-z0-9._-]", string.Empty);
            if (key.Length > 64) key = key.Substring(0, 64);
            var killed = false;
            if (key.Length > 0 && _convertProcs.TryGetValue(key, out var process))
            {
                try { process.Kill(entireProcessTree: true); killed = true; } catch { }
                _convertProcs.TryRemove(key, out _);
            }
            if (key.Length > 0 && _convertJobs.TryGetValue(key, out var job))
            {
                job.Cancelled = true;
                job.Done = true;
                job.Error = "已取消";
                job.Push("已取消（客户端请求）");
            }
            return Results.Json(new { ok = true, killed });
        }).DisableAntiforgery();

        app.MapPost("/api/audio-source", async (HttpContext context) =>
        {
            var id = Regex.Replace(context.Request.Query["id"].FirstOrDefault() ?? string.Empty,
                "[^A-Za-z0-9._-]", string.Empty);
            if (id.Length > 64) id = id.Substring(0, 64);
            if (id.Length == 0) return Results.Json(new { error = "缺少任务 id" }, statusCode: 400);
            var ext = Regex.Replace(context.Request.Headers["X-Audio-Ext"].FirstOrDefault() ?? "bin",
                "[^A-Za-z0-9]", string.Empty);
            if (ext.Length == 0) ext = "bin";
            if (ext.Length > 5) ext = ext.Substring(0, 5);
            Directory.CreateDirectory(_tempRoot);
            PruneAudioSources();
            var target = Path.Combine(_tempRoot, $"audio-{id}.{ext}");
            try
            {
                await using (var file = new FileStream(target, FileMode.Create, FileAccess.Write,
                    FileShare.None, 1024 * 1024, true))
                {
                    await context.Request.Body.CopyToAsync(file, context.RequestAborted);
                }
                var info = new FileInfo(target);
                if (info.Length < 1024)
                {
                    info.Delete();
                    return Results.Json(new { error = "音频数据为空" }, statusCode: 400);
                }
                _audioSources[id] = (target, DateTime.UtcNow);
                return Results.Json(new { ok = true, bytes = info.Length });
            }
            catch (Exception ex)
            {
                try { if (File.Exists(target)) File.Delete(target); } catch { }
                return Results.Json(new { error = "音频上传失败：" + ex.Message }, statusCode: 500);
            }
        }).DisableAntiforgery();

        app.MapGet("/api/convert/log", (string? id) =>
        {
            PruneConvertJobs();
            ConvertLogJob? job = null;
            if (!string.IsNullOrWhiteSpace(id)) _convertJobs.TryGetValue(id, out job);
            return Results.Json(new
            {
                lines = job?.Snapshot() ?? Array.Empty<string>(),
                done = job?.Done ?? false,
                error = job?.Error,
            });
        });

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
        var requestedVendor = OneOf(
            (context.Request.Headers["X-Encoder"].FirstOrDefault() ?? "auto").ToLowerInvariant(),
            EncoderVendors, "auto");
        var encoder = ResolveEncoder(codec, requestedVendor);
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

        var logId = Regex.Replace(context.Request.Headers["X-Log-Id"].FirstOrDefault() ?? string.Empty,
            "[^A-Za-z0-9._-]", string.Empty);
        if (logId.Length > 64) logId = logId.Substring(0, 64);
        ConvertLogJob? logJob = null;
        if (logId.Length > 0)
        {
            PruneConvertJobs();
            logJob = _convertJobs.GetOrAdd(logId, _ => new ConvertLogJob());
            logJob.Reset();
        }

        var playbackRate = 1.0;
        if (double.TryParse(context.Request.Headers["X-Playback-Rate"].FirstOrDefault(),
                System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsedRate))
        {
            playbackRate = Math.Clamp(parsedRate, 0.05, 1.0);
        }
        var retime = playbackRate < 0.995;
        logJob?.Push($"retime {playbackRate:F4}x  fps {fps}  codec {codec}");
        logJob?.Push($"encoder {encoder}  vendor {requestedVendor}  hardware {(EncoderKind(encoder) == "software" ? "no" : "yes")}");

        string? originalAudio = null;
        if ((context.Request.Headers["X-Audio-Original"].FirstOrDefault() ?? string.Empty) == "1"
            && logId.Length > 0 && _audioSources.TryRemove(logId, out var audioEntry)
            && File.Exists(audioEntry.Path))
        {
            originalAudio = audioEntry.Path;
        }
        logJob?.Push(originalAudio != null ? "audio source: original file" : "audio source: recorded stream");

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

            List<string> BuildArgs(string videoEncoder)
            {
                var list = new List<string>
                {
                    "-hide_banner", "-loglevel", "info", "-stats", "-stats_period", "1", "-y",
                    "-i", inputPath,
                };
                if (originalAudio != null) list.AddRange(new[] { "-i", originalAudio });
                list.AddRange(new[]
                {
                    "-map", "0:v:0", "-map", originalAudio != null ? "1:a:0" : "0:a:0?",
                    "-vf", $"{(retime ? string.Create(System.Globalization.CultureInfo.InvariantCulture, $"setpts={playbackRate:F4}*PTS,") : string.Empty)}scale=trunc(iw/2)*2:trunc(ih/2)*2",
                });
                if (retime) list.AddRange(new[] { "-r", fps.ToString() });
                list.AddRange(VideoEncoderArgs(videoEncoder, preset, crf));
                if (NeedsHvc1Tag(videoEncoder)) list.AddRange(new[] { "-tag:v", "hvc1" });
                list.AddRange(new[] { "-pix_fmt", "yuv420p", "-g", gopFrames.ToString() });
                if (retime && originalAudio == null)
                {
                    list.AddRange(new[] { "-af", string.Create(System.Globalization.CultureInfo.InvariantCulture, $"atempo={1 / playbackRate:F4}") });
                }
                if (container == "mp4" || container == "mov") list.AddRange(new[] { "-movflags", "+faststart" });
                list.AddRange(new[] { "-c:a", audioEncoder, "-b:a", $"{audioBitrate}k" });
                list.AddRange(new[] { "-ar", audioCodec == "opus" ? "48000" : sampleRate.ToString() });
                list.AddRange(new[] { "-shortest", outputPath });
                return list;
            }

            async Task<(int Code, string ErrorText, string? StartError)> RunAttemptAsync(string videoEncoder)
            {
                var psi = new ProcessStartInfo
                {
                    FileName = FfmpegPath,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                foreach (var arg in BuildArgs(videoEncoder)) psi.ArgumentList.Add(arg);

                Process? process;
                try
                {
                    process = Process.Start(psi);
                }
                catch (Exception ex)
                {
                    return (-1, ex.Message, ex.Message);
                }
                if (process == null) return (-1, string.Empty, "无法启动 FFmpeg 进程。");
                if (logId.Length > 0) _convertProcs[logId] = process;
                try
                {
                    var errorBuffer = new StringBuilder();
                    var readTask = Task.Run(async () =>
                    {
                        var buffer = new char[4096];
                        var pending = new StringBuilder();
                        try
                        {
                            while (true)
                            {
                                var read = await process.StandardError.ReadAsync(buffer, 0, buffer.Length);
                                if (read <= 0) break;
                                var text = new string(buffer, 0, read);
                                if (errorBuffer.Length < 8000) errorBuffer.Append(text);
                                if (errorBuffer.Length > 8000) errorBuffer.Remove(0, errorBuffer.Length - 8000);
                                if (logJob == null) continue;
                                pending.Append(text);
                                if (pending.Length > 64 * 1024) pending.Remove(0, pending.Length - 8192);
                                var cut = pending.ToString().LastIndexOfAny(new[] { '\r', '\n' });
                                if (cut >= 0)
                                {
                                    logJob.Push(pending.ToString(0, cut));
                                    pending.Remove(0, cut + 1);
                                }
                            }
                        }
                        catch
                        {
                            // Process closed mid-read; the exit code below decides the outcome.
                        }
                        if (logJob != null && pending.Length > 0) logJob.Push(pending.ToString());
                    });

                    using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
                    timeoutCts.CancelAfter(TimeSpan.FromMinutes(Math.Min(60, 15 / playbackRate)));
                    try
                    {
                        await process.WaitForExitAsync(timeoutCts.Token);
                    }
                    catch
                    {
                        try { process.Kill(entireProcessTree: true); } catch { }
                        throw;
                    }

                    await readTask;
                    return (process.ExitCode, errorBuffer.ToString(), null);
                }
                finally
                {
                    if (logId.Length > 0) _convertProcs.TryRemove(logId, out _);
                    process.Dispose();
                }
            }

            var fallback = EncoderKind(encoder) == "software" ? null : ResolveEncoder(codec, "software");
            var attempts = fallback != null && fallback != encoder
                ? new[] { encoder, fallback }
                : new[] { encoder };
            var code = -1;
            var errorText = string.Empty;
            string? startError = null;
            for (var attempt = 0; attempt < attempts.Length; attempt++)
            {
                if (logJob?.Cancelled == true) break;
                var current = attempts[attempt];
                if (attempt > 0) logJob?.Push($"硬件编码失败，回退软件编码 {current}");
                var result = await RunAttemptAsync(current);
                code = result.Code;
                errorText = result.ErrorText;
                startError = result.StartError;
                if (startError != null) break;
                if (logJob != null) { logJob.Done = true; logJob.Error = code == 0 ? null : $"FFmpeg exit {code}"; }
                if (code == 0)
                {
                    if (attempt > 0) logJob?.Push($"已回退到 {current} 完成编码");
                    break;
                }
                if (logJob?.Cancelled == true) break;
                if (attempt + 1 < attempts.Length) logJob?.Push($"{current} 失败（exit {code}），尝试软件编码…");
            }

            if (logJob?.Cancelled == true)
            {
                logJob.Done = true;
                logJob.Error = "已取消";
                TryDeleteDirectory(jobDir);
                return Results.Json(new { error = "已取消" }, statusCode: 499);
            }
            if (startError != null)
            {
                if (logJob != null) { logJob.Done = true; logJob.Error = startError; }
                TryDeleteDirectory(jobDir);
                return Results.Json(new { error = startError },
                    statusCode: StatusCodes.Status500InternalServerError);
            }
            if (logJob != null)
            {
                logJob.Done = true;
                logJob.Error = code == 0 ? null : $"FFmpeg exit {code}";
                if (code == 0) logJob.Push("封装完成");
            }
            if (code != 0 || !File.Exists(outputPath))
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
            if (logJob != null) { logJob.Done = true; logJob.Error = "转码已取消"; }
            TryDeleteDirectory(jobDir);
            return Results.StatusCode(499);
        }
        catch (Exception ex)
        {
            if (logJob != null && !logJob.Cancelled)
            {
                logJob.Done = true;
                logJob.Error = ex.Message;
                logJob.Push("error: " + ex.Message);
            }
            AppPaths.Log("Convert error: " + ex);
            TryDeleteDirectory(jobDir);
            return Results.Json(new { error = "转码服务异常：" + ex.Message },
                statusCode: StatusCodes.Status500InternalServerError);
        }
        finally
        {
            if (originalAudio != null)
            {
                try { if (File.Exists(originalAudio)) File.Delete(originalAudio); } catch { }
            }
        }
    }

    private void PruneAudioSources()
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-30);
        foreach (var pair in _audioSources)
        {
            if (pair.Value.At > cutoff) continue;
            if (!_audioSources.TryRemove(pair.Key, out var entry)) continue;
            try { if (File.Exists(entry.Path)) File.Delete(entry.Path); } catch { }
        }
    }

    private void PruneConvertJobs()
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-10);
        foreach (var pair in _convertJobs)
        {
            if (pair.Value.UpdatedAt < cutoff) _convertJobs.TryRemove(pair.Key, out _);
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

        if (FfmpegPath != null)
        {
            DetectEncoders();
            DetectHwVendors();
        }
    }

    private void DetectHwVendors()
    {
        _hwVendors.Clear();
        if (FfmpegPath == null) return;
        foreach (var pair in HwEncoders)
        {
            if (!pair.Value.TryGetValue("h264", out var name)) continue;
            if (_encoders.Count > 0 && !_encoders.Contains(name)) continue;
            if (ProbeEncoder(name)) _hwVendors.Add(pair.Key);
        }
    }

    private bool ProbeEncoder(string name)
    {
        // A full FFmpeg build lists every encoder it was compiled with, including
        // GPUs that are not installed. Encode two tiny frames to check for real.
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = FfmpegPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            foreach (var arg in new[]
            {
                "-hide_banner", "-loglevel", "error", "-nostdin",
                "-f", "lavfi", "-i", "nullsrc=s=320x240:d=0.1",
                "-frames:v", "2", "-pix_fmt", "yuv420p", "-c:v", name, "-f", "null", "-",
            })
            {
                psi.ArgumentList.Add(arg);
            }
            using var process = Process.Start(psi);
            if (process == null) return false;
            process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            if (!process.WaitForExit(6000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return false;
            }
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
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
                if (match.Success && Regex.IsMatch(match.Groups[1].Value, @"^[A-Za-z0-9_.-]{2,}$"))
                {
                    _encoders.Add(match.Groups[1].Value);
                }
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
        if (_encoders.Contains("libx264") || _encoders.Contains("h264_nvenc") || _encoders.Contains("h264_amf") || _encoders.Contains("h264_qsv")) codecs.Add("h264");
        if (_encoders.Contains("libx265") || _encoders.Contains("hevc_nvenc") || _encoders.Contains("hevc_amf") || _encoders.Contains("hevc_qsv")) codecs.Add("h265");
        if (_encoders.Contains("libvpx-vp9")) codecs.Add("vp9");
        if (_encoders.Contains("libvpx")) codecs.Add("vp8");
        if (_encoders.Contains("libsvtav1") || _encoders.Contains("libaom-av1")
            || _encoders.Contains("av1_nvenc") || _encoders.Contains("av1_amf") || _encoders.Contains("av1_qsv")) codecs.Add("av1");
        return codecs;
    }

    private List<string> AvailableAudioCodecs()
    {
        var codecs = new List<string>();
        if (_encoders.Contains("aac")) codecs.Add("aac");
        if (_encoders.Contains("libopus") || _encoders.Contains("opus")) codecs.Add("opus");
        return codecs;
    }

    private static string EncoderKind(string name)
    {
        if (name.EndsWith("_nvenc", StringComparison.OrdinalIgnoreCase)) return "nvidia";
        if (name.EndsWith("_amf", StringComparison.OrdinalIgnoreCase)) return "amd";
        if (name.EndsWith("_qsv", StringComparison.OrdinalIgnoreCase)) return "intel";
        return "software";
    }

    private bool EncoderAvailable(string name)
    {
        return _encoders.Count == 0 || _encoders.Contains(name);
    }

    private string? ResolveEncoder(string codec, string vendor)
    {
        if (vendor != "software" && (vendor != "auto" || _encoders.Count > 0))
        {
            var order = vendor == "auto"
                ? new[] { "nvidia", "amd", "intel" }.Where(v => _hwVendors.Contains(v))
                : new[] { vendor };
            foreach (var candidate in order)
            {
                if (!HwEncoders.TryGetValue(candidate, out var map)) continue;
                if (!map.TryGetValue(codec, out var name)) continue;
                if (EncoderAvailable(name)) return name;
            }
        }
        if (codec == "av1")
        {
            if (EncoderAvailable("libsvtav1")) return "libsvtav1";
            if (EncoderAvailable("libaom-av1")) return "libaom-av1";
            return _encoders.Count == 0 ? "libsvtav1" : null;
        }
        if (!SoftwareEncoders.TryGetValue(codec, out var software)) return null;
        return EncoderAvailable(software) ? software : null;
    }

    private string[] VideoEncoderArgs(string name, string preset, int crf)
    {
        var kind = EncoderKind(name);
        if (kind == "nvidia")
        {
            return new[] { "-c:v", name, "-preset", $"p{NvencPreset.GetValueOrDefault(preset, 5)}", "-rc", "vbr", "-cq", crf.ToString(), "-b:v", "0" };
        }
        if (kind == "amd")
        {
            return new[] { "-c:v", name, "-quality", AmfQuality.GetValueOrDefault(preset, "balanced"), "-rc", "cqp", "-qp_i", crf.ToString(), "-qp_p", crf.ToString(), "-qp_b", crf.ToString() };
        }
        if (kind == "intel")
        {
            return new[] { "-c:v", name, "-preset", QsvPreset.GetValueOrDefault(preset, "medium"), "-global_quality", crf.ToString() };
        }
        return name switch
        {
            "libx264" or "libx265" => new[] { "-c:v", name, "-preset", preset, "-crf", crf.ToString() },
            "libsvtav1" => new[] { "-c:v", "libsvtav1", "-preset", SvtPreset.GetValueOrDefault(preset, 6).ToString(), "-crf", crf.ToString() },
            "libaom-av1" => new[] { "-c:v", "libaom-av1", "-cpu-used", "6", "-row-mt", "1", "-crf", crf.ToString(), "-b:v", "0" },
            _ => new[] { "-c:v", name, "-crf", crf.ToString(), "-b:v", "0", "-cpu-used", VpxSpeed.GetValueOrDefault(preset, 4).ToString(), "-row-mt", "1" },
        };
    }

    private static bool NeedsHvc1Tag(string name)
    {
        return name.StartsWith("hevc_", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(name, "libx265", StringComparison.OrdinalIgnoreCase);
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
