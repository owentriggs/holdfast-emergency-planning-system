// "Start Holdfast.exe" on a backup drive: starts the program copied to the App folder next to it.
// A .cmd launcher cannot have its own icon, so this exists to carry the Holdfast logo.
// Built by scripts/build-launcher.js.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class Launcher {
  [STAThread]
  static void Main(string[] args) {
    string app = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "App");
    string exe = Directory.Exists(app)
      ? Directory.GetFiles(app, "*.exe").FirstOrDefault(f => !Path.GetFileName(f).StartsWith("Uninstall", StringComparison.OrdinalIgnoreCase))
      : null;
    if (exe == null) {
      MessageBox.Show("The Holdfast program was not found in the App folder next to this launcher.", "Holdfast", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return;
    }
    var info = new ProcessStartInfo(exe, string.Join(" ", args.Select(a => "\"" + a + "\""))) { WorkingDirectory = app, UseShellExecute = false };
    Process.Start(info);
  }
}
