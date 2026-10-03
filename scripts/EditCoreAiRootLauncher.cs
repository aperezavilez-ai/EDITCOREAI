// Launcher: abre SIEMPRE el proyecto en la carpeta raíz (donde está este EXE).
// Arranca EDITCOREAI-host.exe (runtime brandado), NUNCA electron.exe suelto con logo Electron.
// Si el proyecto vive en un disco lento (HDD), el runtime se ejecuta desde una copia en
// %LOCALAPPDATA%\EDITCOREAI\runtime: desde el HDD Electron tarda 45-90 s solo en arrancar.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("EditCoreAI")]
[assembly: AssemblyDescription("Launcher EditCoreAI (carpeta raíz del proyecto)")]
[assembly: AssemblyCompany("EditCoreAI")]
[assembly: AssemblyProduct("EditCoreAI")]
[assembly: AssemblyCopyright("Copyright © EditCoreAI")]
[assembly: AssemblyVersion("4.2.4.0")]
[assembly: AssemblyFileVersion("4.2.4.0")]
[assembly: AssemblyInformationalVersion("4.2.4")]

internal static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [STAThread]
    private static void Main()
    {
        try { SetCurrentProcessExplicitAppUserModelID("com.editcoreai.app"); } catch { /* ignore */ }

        // Varios clics seguidos no deben lanzar varias copias mientras la primera arranca.
        bool firstLauncher;
        using (var mutex = new Mutex(true, "Local\\EditCoreAI.RootLauncher", out firstLauncher))
        {
            if (!firstLauncher) return;
            Launch();
        }
    }

    private static void Launch()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string dist = Path.Combine(root, "node_modules", "electron", "dist");
        string host = Path.Combine(dist, "EDITCOREAI-host.exe");
        string electron = Path.Combine(dist, "electron.exe");
        string runtime = File.Exists(host) ? host : electron;
        string mainJs = Path.Combine(root, "main.js");
        string kernel = Path.Combine(root, "editcore-chat-kernel", "index.js");

        if (!File.Exists(mainJs) || !File.Exists(kernel))
        {
            MessageBox.Show(
                "Este EDITCOREAI.exe debe estar en la carpeta raíz del proyecto.\n\nRuta actual:\n" + root,
                "EditCoreAI",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (!File.Exists(runtime))
        {
            MessageBox.Show(
                "Falta el runtime de EditCoreAI.\nEjecuta npm install en:\n" + root,
                "EditCoreAI",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        runtime = CachedRuntime(dist, runtime);

        var psi = new ProcessStartInfo
        {
            FileName = runtime,
            Arguments = "\"" + root + "\"",
            WorkingDirectory = root,
            UseShellExecute = false,
        };
        psi.EnvironmentVariables["EDITCORE_USER_DATA_PATH"] =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EDITCOREAI");
        psi.EnvironmentVariables.Remove("ELECTRON_FORCE_IS_PACKAGED");
        // Agrupa la ventana en la barra de tareas como EditCoreAI, no como Electron.
        psi.EnvironmentVariables["ELECTRON_APP_USER_MODEL_ID"] = "com.editcoreai.app";

        Process.Start(psi);
    }

    /// Devuelve el runtime copiado en LOCALAPPDATA (resincronizado si cambió); ante cualquier fallo, el original.
    private static string CachedRuntime(string dist, string runtime)
    {
        try
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrEmpty(local)) return runtime;
            if (string.Equals(Path.GetPathRoot(local), Path.GetPathRoot(dist), StringComparison.OrdinalIgnoreCase)) return runtime;

            string cacheDir = Path.Combine(local, "EDITCOREAI", "runtime");
            string cached = Path.Combine(cacheDir, Path.GetFileName(runtime));
            string stampPath = Path.Combine(cacheDir, "runtime.stamp");
            var info = new FileInfo(runtime);
            string stamp = info.Length + "|" + info.LastWriteTimeUtc.Ticks + "|" + ReadText(Path.Combine(dist, "version"));

            if (File.Exists(cached) && ReadText(stampPath) == stamp) return cached;

            string staging = cacheDir + ".new";
            using (var splash = ShowSplash())
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
                CopyDirectory(dist, staging);
                File.WriteAllText(Path.Combine(staging, "runtime.stamp"), stamp);
                if (Directory.Exists(cacheDir)) Directory.Delete(cacheDir, true);
                Directory.Move(staging, cacheDir);
            }
            return File.Exists(cached) ? cached : runtime;
        }
        catch
        {
            return runtime;
        }
    }

    private static string ReadText(string file)
    {
        try { return File.Exists(file) ? File.ReadAllText(file).Trim() : ""; } catch { return ""; }
    }

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(target, dir.Substring(source.Length + 1)));
        }
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            File.Copy(file, Path.Combine(target, file.Substring(source.Length + 1)), true);
            Application.DoEvents();
        }
    }

    private static Form ShowSplash()
    {
        var form = new Form
        {
            Text = "EditCoreAI",
            FormBorderStyle = FormBorderStyle.FixedToolWindow,
            StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(360, 70),
            ControlBox = false,
            TopMost = true,
            ShowInTaskbar = true,
        };
        form.Controls.Add(new Label
        {
            Text = "Preparando EditCoreAI para un arranque rápido…\nSolo ocurre tras instalar o actualizar.",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
        });
        form.Show();
        Application.DoEvents();
        return form;
    }
}
