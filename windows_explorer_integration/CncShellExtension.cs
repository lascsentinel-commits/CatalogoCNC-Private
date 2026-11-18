using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace CncShellExtension
{
    #region COM Interfaces and Structs

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    public enum WTS_ALPHATYPE : uint
    {
        WTSAT_UNKNOWN = 0,
        WTSAT_RGB = 1,
        WTSAT_ARGB = 2
    }

    [ComImport]
    [Guid("b7d14566-0509-4cce-a71f-0a554233bd9b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IInitializeWithFile
    {
        void Initialize([MarshalAs(UnmanagedType.LPWStr)] string pszFilePath, uint grfMode);
    }

    [ComImport]
    [Guid("8895b1c6-b41f-4c1c-a562-0d564250836f")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPreviewHandler
    {
        void SetWindow(IntPtr hwnd, ref RECT prc);
        void SetRect(ref RECT prc);
        void DoPreview();
        void Unload();
        void SetFocus();
        void QueryFocus(out IntPtr phwnd);
        [PreserveSig]
        uint TranslateAccelerator(ref MSG pmsg);
    }

    [ComImport]
    [Guid("00000114-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IOleWindow
    {
        void GetWindow(out IntPtr phwnd);
        void ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool fEnterMode);
    }

    [ComImport]
    [Guid("FC4801A3-2BA9-11CF-A229-00AA003D7352")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IObjectWithSite
    {
        void SetSite([In, MarshalAs(UnmanagedType.IUnknown)] object pUnkSite);
        void GetSite(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvSite);
    }

    [ComImport]
    [Guid("e357fccd-a995-4576-b01f-234630154e96")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IThumbnailProvider
    {
        void GetThumbnail(uint cx, out IntPtr phbmp, out WTS_ALPHATYPE pdwAlpha);
    }

    #endregion

    internal static class CncVisualResolver
    {
        private static readonly string[] ImgExts = { ".png", ".jpg", ".jpeg", ".bmp", ".webp" };
        private static readonly Regex RegexX = new Regex(@"X\s*([-+]?\d*\.?\d+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex RegexY = new Regex(@"Y\s*([-+]?\d*\.?\d+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex RegexZ = new Regex(@"Z\s*([-+]?\d*\.?\d+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public static string ComputeMd5Hex12(string text)
        {
            using (var md5 = MD5.Create())
            {
                byte[] bytes = Encoding.UTF8.GetBytes(text ?? string.Empty);
                byte[] hash = md5.ComputeHash(bytes);
                var sb = new StringBuilder();
                for (int i = 0; i < hash.Length; i++) sb.Append(hash[i].ToString("x2"));
                return sb.ToString().Substring(0, 12);
            }
        }

        public static string FindCapturesDirFromDll()
        {
            try
            {
                string dllDir = Path.GetDirectoryName(typeof(CncVisualResolver).Assembly.Location);
                if (!string.IsNullOrEmpty(dllDir))
                {
                    // DLL vive en <CatalogoCNC>\windows_explorer_integration\CncShellExtension.dll
                    DirectoryInfo parent = Directory.GetParent(dllDir);
                    if (parent != null)
                    {
                        string cap = Path.Combine(parent.FullName, "captures");
                        if (Directory.Exists(cap)) return cap;
                    }
                }
            }
            catch { }
            return null;
        }

        public static string FindRealPhoto(string cncFilePath, out bool isRealPhoto)
        {
            isRealPhoto = false;
            if (string.IsNullOrEmpty(cncFilePath) || !File.Exists(cncFilePath))
                return null;

            string dir = Path.GetDirectoryName(cncFilePath);
            string stem = Path.GetFileNameWithoutExtension(cncFilePath);
            string fullName = Path.GetFileName(cncFilePath);

            // 1. Foto exacta junto al archivo: <nombre>.png / <nombre.nc>.png
            foreach (string ext in ImgExts)
            {
                string p1 = Path.Combine(dir, stem + ext);
                if (File.Exists(p1)) { isRealPhoto = true; return p1; }
                string p2 = Path.Combine(dir, fullName + ext);
                if (File.Exists(p2)) { isRealPhoto = true; return p2; }
            }

            // 2. preview.png / preview.jpg / folder.jpg en la misma carpeta
            string[] named = { "preview.png", "preview.jpg", "preview.jpeg", "folder.png", "folder.jpg", "folder.jpeg" };
            foreach (string n in named)
            {
                string p = Path.Combine(dir, n);
                if (File.Exists(p)) { isRealPhoto = true; return p; }
            }

            // 3. Cualquier imagen real dentro de la misma carpeta
            try
            {
                foreach (string ext in ImgExts)
                {
                    string[] matches = Directory.GetFiles(dir, "*" + ext);
                    if (matches != null && matches.Length > 0)
                    {
                        Array.Sort(matches, StringComparer.OrdinalIgnoreCase);
                        isRealPhoto = true;
                        return matches[0];
                    }
                }
            }
            catch { }

            // 4. Buscar en captures/ del catálogo por MD5(ruta_archivo) o MD5(carpeta)
            string capDir = FindCapturesDirFromDll();
            if (!string.IsNullOrEmpty(capDir))
            {
                string[] hashes = { ComputeMd5Hex12(cncFilePath), ComputeMd5Hex12(dir) };
                foreach (string h in hashes)
                {
                    foreach (string ext in ImgExts)
                    {
                        string cp = Path.Combine(capDir, h + ext);
                        if (File.Exists(cp)) { isRealPhoto = true; return cp; }
                    }
                }
            }

            return null;
        }

        public static Bitmap LoadUnlockedBitmap(string imagePath)
        {
            byte[] bytes = File.ReadAllBytes(imagePath);
            using (var ms = new MemoryStream(bytes))
            using (var src = Image.FromStream(ms))
            {
                return new Bitmap(src);
            }
        }

        public static Bitmap RenderGcodeFallbackBitmap(string cncFilePath, int width, int height, bool drawBanner)
        {
            var bmp = new Bitmap(Math.Max(64, width), Math.Max(64, height), PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.FromArgb(255, 10, 15, 29));

                string ext = (Path.GetExtension(cncFilePath) ?? "").ToLowerInvariant();
                bool isGcode = ext == ".nc" || ext == ".gcode" || ext == ".ngc" || ext == ".tap";

                if (isGcode && File.Exists(cncFilePath))
                {
                    var segments = new List<PointF[]>();
                    double curX = 0, curY = 0, curZ = 10;
                    double minX = double.MaxValue, maxX = double.MinValue;
                    double minY = double.MaxValue, maxY = double.MinValue;
                    bool hasCut = false;

                    int lineCount = 0;
                    foreach (string rawLine in File.ReadLines(cncFilePath))
                    {
                        if (++lineCount > 45000) break;
                        string line = rawLine;
                        int sc = line.IndexOf(';');
                        if (sc >= 0) line = line.Substring(0, sc);
                        line = line.Trim();
                        if (line.Length == 0) continue;

                        double nextX = curX, nextY = curY, nextZ = curZ;
                        Match mx = RegexX.Match(line);
                        Match my = RegexY.Match(line);
                        Match mz = RegexZ.Match(line);

                        if (mx.Success) double.TryParse(mx.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out nextX);
                        if (my.Success) double.TryParse(my.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out nextY);
                        if (mz.Success) double.TryParse(mz.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out nextZ);

                        bool isRapid = line.StartsWith("G0 ", StringComparison.OrdinalIgnoreCase) || line.StartsWith("G00", StringComparison.OrdinalIgnoreCase);
                        if ((nextX != curX || nextY != curY) && nextZ <= 0.1 && !isRapid)
                        {
                            segments.Add(new[] { new PointF((float)curX, (float)curY), new PointF((float)nextX, (float)nextY) });
                            if (curX < minX) minX = curX; if (nextX < minX) minX = nextX;
                            if (curX > maxX) maxX = curX; if (nextX > maxX) maxX = nextX;
                            if (curY < minY) minY = curY; if (nextY < minY) minY = nextY;
                            if (curY > maxY) maxY = curY; if (nextY > maxY) maxY = nextY;
                            hasCut = true;
                        }

                        curX = nextX; curY = nextY; curZ = nextZ;
                    }

                    if (hasCut && segments.Count > 0)
                    {
                        double spanX = Math.Max(1.0, maxX - minX);
                        double spanY = Math.Max(1.0, maxY - minY);
                        float pad = Math.Max(16f, Math.Min(width, height) * 0.14f);
                        float topOffset = drawBanner ? 34f : pad;
                        float availW = Math.Max(20f, width - pad * 2f);
                        float availH = Math.Max(20f, height - pad - topOffset);
                        float scale = (float)Math.Min(availW / spanX, availH / spanY);
                        float offX = pad + (availW - (float)(spanX * scale)) / 2f;
                        float offY = topOffset + (availH - (float)(spanY * scale)) / 2f;

                        using (var pen = new Pen(Color.FromArgb(240, 56, 189, 248), Math.Max(1.4f, width / 180f)))
                        {
                            int step = segments.Count > 12000 ? 2 : 1;
                            for (int i = 0; i < segments.Count; i += step)
                            {
                                PointF a = segments[i][0];
                                PointF b = segments[i][1];
                                float x1 = offX + (float)((a.X - minX) * scale);
                                float y1 = offY + (float)((maxY - a.Y) * scale);
                                float x2 = offX + (float)((b.X - minX) * scale);
                                float y2 = offY + (float)((maxY - b.Y) * scale);
                                g.DrawLine(pen, x1, y1, x2, y2);
                            }
                        }
                    }
                    else
                    {
                        DrawCenterBadge(g, width, height, ext.ToUpperInvariant(), Color.FromArgb(255, 248, 113, 113));
                    }
                }
                else
                {
                    DrawCenterBadge(g, width, height, ext == ".c2d" ? "CARBIDE .C2D\nSIN FOTO" : "CNC\nSIN FOTO", Color.FromArgb(255, 248, 113, 113));
                }

                // Borde rojo sutil indicando que aún falta foto real
                using (var borderPen = new Pen(Color.FromArgb(220, 239, 68, 68), Math.Max(2f, width / 90f)))
                {
                    g.DrawRectangle(borderPen, 2, 2, width - 5, height - 5);
                }

                if (drawBanner)
                {
                    using (var bgBrush = new SolidBrush(Color.FromArgb(220, 185, 28, 28)))
                    using (var txtBrush = new SolidBrush(Color.White))
                    using (var font = new Font("Segoe UI", Math.Max(8f, width / 22f), FontStyle.Bold))
                    {
                        g.FillRectangle(bgBrush, 0, 0, width, 26);
                        g.DrawString("FALTA FOTO REAL (VECTORIAL)", font, txtBrush, 8, 4);
                    }
                }
            }
            return bmp;
        }

        private static void DrawCenterBadge(Graphics g, int width, int height, string text, Color color)
        {
            using (var font = new Font("Segoe UI", Math.Max(10f, width / 11f), FontStyle.Bold))
            using (var brush = new SolidBrush(color))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(text, font, brush, new RectangleF(6, 6, width - 12, height - 12), sf);
            }
        }
    }

    /// <summary>
    /// Manejador del Panel de Vista Previa (Alt + P) del Explorador de Windows para .nc y .c2d.
    /// </summary>
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    [Guid("7F3E9C11-8B2A-4D5F-9A1E-4C6B2D8E0F11")]
    public class CncPreviewHandler : IPreviewHandler, IInitializeWithFile, IOleWindow, IObjectWithSite
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        private string _filePath;
        private IntPtr _parentHwnd = IntPtr.Zero;
        private RECT _bounds;
        private object _site;
        private Panel _hostPanel;
        private PictureBox _pictureBox;
        private Label _headerLabel;

        public void Initialize(string pszFilePath, uint grfMode)
        {
            _filePath = pszFilePath;
        }

        public void SetWindow(IntPtr hwnd, ref RECT prc)
        {
            _parentHwnd = hwnd;
            _bounds = prc;
            EnsureControl();
            UpdateLayout();
        }

        public void SetRect(ref RECT prc)
        {
            _bounds = prc;
            UpdateLayout();
        }

        public void DoPreview()
        {
            EnsureControl();
            UpdateLayout();
            LoadPreviewContent();
        }

        public void Unload()
        {
            if (_pictureBox != null && _pictureBox.Image != null)
            {
                Image old = _pictureBox.Image;
                _pictureBox.Image = null;
                old.Dispose();
            }
            if (_hostPanel != null)
            {
                _hostPanel.Dispose();
                _hostPanel = null;
            }
            _pictureBox = null;
            _headerLabel = null;
        }

        public void SetFocus()
        {
            if (_hostPanel != null) _hostPanel.Focus();
        }

        public void QueryFocus(out IntPtr phwnd)
        {
            phwnd = (_hostPanel != null && _hostPanel.IsHandleCreated) ? _hostPanel.Handle : IntPtr.Zero;
        }

        public uint TranslateAccelerator(ref MSG pmsg)
        {
            return 1; // S_FALSE
        }

        public void GetWindow(out IntPtr phwnd)
        {
            phwnd = (_hostPanel != null && _hostPanel.IsHandleCreated) ? _hostPanel.Handle : IntPtr.Zero;
        }

        public void ContextSensitiveHelp(bool fEnterMode) { }

        public void SetSite(object pUnkSite)
        {
            _site = pUnkSite;
        }

        public void GetSite(ref Guid riid, out object ppvSite)
        {
            ppvSite = _site;
        }

        private void EnsureControl()
        {
            if (_hostPanel != null) return;

            _hostPanel = new Panel
            {
                BackColor = Color.FromArgb(10, 15, 29),
                BorderStyle = BorderStyle.None
            };

            _headerLabel = new Label
            {
                Dock = DockStyle.Top,
                Height = 46,
                BackColor = Color.FromArgb(17, 24, 39),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(12, 0, 12, 0),
                Text = "Cargando vista previa CNC..."
            };

            _pictureBox = new PictureBox
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(10, 15, 29),
                SizeMode = PictureBoxSizeMode.Zoom
            };

            _hostPanel.Controls.Add(_pictureBox);
            _hostPanel.Controls.Add(_headerLabel);
            _hostPanel.CreateControl();

            if (_parentHwnd != IntPtr.Zero)
            {
                SetParent(_hostPanel.Handle, _parentHwnd);
            }
        }

        private void UpdateLayout()
        {
            if (_hostPanel == null) return;
            int w = Math.Max(50, _bounds.right - _bounds.left);
            int h = Math.Max(50, _bounds.bottom - _bounds.top);
            if (_parentHwnd != IntPtr.Zero && _hostPanel.IsHandleCreated)
            {
                SetParent(_hostPanel.Handle, _parentHwnd);
            }
            _hostPanel.SetBounds(0, 0, w, h);
            _hostPanel.Show();
        }

        private void LoadPreviewContent()
        {
            if (_pictureBox == null || _headerLabel == null || string.IsNullOrEmpty(_filePath)) return;

            try
            {
                if (_pictureBox.Image != null)
                {
                    Image prev = _pictureBox.Image;
                    _pictureBox.Image = null;
                    prev.Dispose();
                }

                string fileName = Path.GetFileName(_filePath);
                bool hasRealPhoto;
                string photoPath = CncVisualResolver.FindRealPhoto(_filePath, out hasRealPhoto);

                if (hasRealPhoto && !string.IsNullOrEmpty(photoPath))
                {
                    _headerLabel.BackColor = Color.FromArgb(6, 78, 59);
                    _headerLabel.ForeColor = Color.FromArgb(209, 250, 229);
                    _headerLabel.Text = "🟢 FOTO REAL LISTA · " + fileName;
                    _pictureBox.Image = CncVisualResolver.LoadUnlockedBitmap(photoPath);
                }
                else
                {
                    _headerLabel.BackColor = Color.FromArgb(127, 29, 29);
                    _headerLabel.ForeColor = Color.FromArgb(254, 226, 226);
                    _headerLabel.Text = "🔴 FALTA FOTO REAL · Vista Vectorial G-Code · " + fileName;
                    int rw = Math.Max(320, _hostPanel.Width);
                    int rh = Math.Max(240, _hostPanel.Height - 46);
                    _pictureBox.Image = CncVisualResolver.RenderGcodeFallbackBitmap(_filePath, rw, rh, false);
                }
            }
            catch (Exception ex)
            {
                _headerLabel.BackColor = Color.FromArgb(127, 29, 29);
                _headerLabel.Text = "Error cargando vista previa: " + ex.Message;
            }
        }
    }

    /// <summary>
    /// Proveedor de Miniaturas del Explorador de Windows (Iconos Medianos, Grandes y Muy Grandes) para .nc y .c2d.
    /// </summary>
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    [Guid("8A4F1D22-9C3B-4E6A-8B2F-5D7C3E9A1B22")]
    public class CncThumbnailProvider : IThumbnailProvider, IInitializeWithFile
    {
        private string _filePath;

        public void Initialize(string pszFilePath, uint grfMode)
        {
            _filePath = pszFilePath;
        }

        public void GetThumbnail(uint cx, out IntPtr phbmp, out WTS_ALPHATYPE pdwAlpha)
        {
            int size = (int)Math.Max(64, Math.Min(512, cx));
            Bitmap resultBmp = null;

            try
            {
                bool hasRealPhoto;
                string photoPath = CncVisualResolver.FindRealPhoto(_filePath, out hasRealPhoto);

                if (hasRealPhoto && !string.IsNullOrEmpty(photoPath))
                {
                    using (Bitmap src = CncVisualResolver.LoadUnlockedBitmap(photoPath))
                    {
                        resultBmp = FitBitmapToSquare(src, size, true);
                    }
                }
                else
                {
                    resultBmp = CncVisualResolver.RenderGcodeFallbackBitmap(_filePath, size, size, size >= 128);
                }

                phbmp = resultBmp.GetHbitmap(Color.FromArgb(255, 10, 15, 29));
                pdwAlpha = WTS_ALPHATYPE.WTSAT_RGB;
            }
            catch
            {
                using (var fallback = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                {
                    phbmp = fallback.GetHbitmap(Color.FromArgb(255, 10, 15, 29));
                    pdwAlpha = WTS_ALPHATYPE.WTSAT_RGB;
                }
            }
            finally
            {
                if (resultBmp != null) resultBmp.Dispose();
            }
        }

        private static Bitmap FitBitmapToSquare(Bitmap src, int size, bool isReady)
        {
            var canvas = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(canvas))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.FromArgb(255, 12, 18, 32));

                float pad = Math.Max(4f, size * 0.04f);
                float maxW = size - pad * 2f;
                float maxH = size - pad * 2f;
                float scale = Math.Min(maxW / src.Width, maxH / src.Height);
                float drawW = src.Width * scale;
                float drawH = src.Height * scale;
                float x = (size - drawW) / 2f;
                float y = (size - drawH) / 2f;

                g.DrawImage(src, x, y, drawW, drawH);

                // Marco verde esmeralda indicando imagen real asignada
                if (isReady)
                {
                    using (var pen = new Pen(Color.FromArgb(230, 16, 185, 129), Math.Max(2f, size / 64f)))
                    {
                        g.DrawRectangle(pen, 1, 1, size - 3, size - 3);
                    }
                }
            }
            return canvas;
        }
    }
}
