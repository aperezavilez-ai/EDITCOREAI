// Launcher: abre SIEMPRE el proyecto en la carpeta raíz (donde está este EXE).
// El proceso ya está brandado como EditCoreAI (icono + metadatos). Nunca exponer marca Electron.
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
[assembly: AssemblyVersion("2.9.3.0")]
[assembly: AssemblyFileVersion("2.9.3.0")]
[assembly: AssemblyInformationalVersion("2.9.3")]

internal static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [STAThread]
    private static void Main()
    {
        try { SetCurrentProcessExplicitAppUserModelID("com.editcoreai.app"); } catch { /* ignore */ }

        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
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

        if (!File.Exists(electron))
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
            FileName = electron,
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
