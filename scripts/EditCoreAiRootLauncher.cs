// Launcher: abre SIEMPRE el proyecto en la carpeta raíz (donde está este EXE).
// Nunca apunta a release\ ni a otra copia.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("EDITCOREAI")]
[assembly: AssemblyDescription("Launcher del proyecto EDITCOREAI (carpeta raíz)")]
[assembly: AssemblyCompany("EDITCOREAI")]
[assembly: AssemblyProduct("EDITCOREAI")]
[assembly: AssemblyCopyright("Copyright © EDITCOREAI")]
[assembly: AssemblyVersion("2.8.1.0")]
[assembly: AssemblyFileVersion("2.8.1.0")]
[assembly: AssemblyInformationalVersion("2.8.1")]

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
        string mainJs = Path.Combine(root, "main.js");
        string kernel = Path.Combine(root, "editcore-chat-kernel", "index.js");

        if (!File.Exists(mainJs) || !File.Exists(kernel))
        {
            MessageBox.Show(
                "Este EDITCOREAI.exe debe estar en la carpeta raíz del proyecto.\n\nRuta actual:\n" + root,
                "EDITCOREAI",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (!File.Exists(electron))
        {
            MessageBox.Show(
                "Falta Electron.\nEjecuta npm install en:\n" + root,
                "EDITCOREAI",
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

        Process.Start(psi);
    }
}
