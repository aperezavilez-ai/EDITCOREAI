// Launcher: abre SIEMPRE el proyecto en la carpeta raíz (donde está este EXE).
// Arranca EDITCOREAI-host.exe (runtime brandado), NUNCA electron.exe suelto con logo Electron.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

[assembly: AssemblyTitle("EditCoreAI")]
[assembly: AssemblyDescription("Launcher EditCoreAI (carpeta raíz del proyecto)")]
[assembly: AssemblyCompany("EditCoreAI")]
[assembly: AssemblyProduct("EditCoreAI")]
[assembly: AssemblyCopyright("Copyright © EditCoreAI")]
[assembly: AssemblyVersion("4.0.0.0")]
[assembly: AssemblyFileVersion("4.0.0.0")]
[assembly: AssemblyInformationalVersion("4.0.0")]

internal static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [STAThread]
    private static void Main()
    {
        try { SetCurrentProcessExplicitAppUserModelID("com.editcoreai.app"); } catch { /* ignore */ }

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

        var psi = new ProcessStartInfo
        {
            FileName = runtime,
            Arguments = "\".\"",
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
}
