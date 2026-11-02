// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-01: graphical per-user WSL installer and console-free Windows launcher.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Threading;
using System.Security.Principal;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;

namespace ASEStudioSetup {
    public class Candidate {
        public string Name { get; set; }
        public bool Compatible { get; set; }
        public bool IsDefault { get; set; }
        public string Reason { get; set; }
        public override string ToString() { return Name + (Compatible ? " — compatibile" : " — " + Reason); }
    }
    public class SetupWindow : Window {
        readonly ComboBox distro = new ComboBox { MinWidth = 560, Margin = new Thickness(0,8,0,8) };
        readonly TextBox user = new TextBox { ToolTip = "Utente Linux; vuoto per usare quello predefinito", Margin = new Thickness(0,4,0,8) };
        readonly TextBox log = new TextBox { IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Height = 270 };
        readonly List<Button> buttons = new List<Button>();
        readonly ProgressBar progress = new ProgressBar { Height=6, Margin=new Thickness(0,4,0,10) };
        bool busy;
        string cancelPath;
        readonly Button cancel = new Button { Content="Annulla preparazione", IsEnabled=false, Padding=new Thickness(10,6,10,6), Margin=new Thickness(0,0,8,10) };
        string savedAction;
        public SetupWindow(string action) {
            Title = "Installazione ASE Studio"; Width = 760; Height = 740; MinWidth = 650; MinHeight = 700;
            savedAction = action;
            if (action == "launch") { ShowInTaskbar=false; Opacity=0; WindowState=WindowState.Minimized; }
            var panel = new StackPanel { Margin = new Thickness(22) }; Content = panel;
            panel.Children.Add(new TextBlock { Text = "ASE Studio", FontSize = 26 });
            panel.Children.Add(new TextBlock { Text = "Studio usa WSL2. Scegli dove installarlo: i tuoi progetti restano separati dall’applicazione.", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0,8,0,10) });
            panel.Children.Add(new TextBlock { Text = "Utente Linux (facoltativo)" }); panel.Children.Add(user);
            panel.Children.Add(distro);
            var actions = new WrapPanel(); panel.Children.Add(actions);
            Add(actions,"Controlla distro", async () => await Discover());
            Add(actions,"Prepara WSL", async () => {
                if (MessageBox.Show(this,"Installare WSL e Ubuntu 24.04 se necessari? Windows potrà richiedere privilegi amministrativi e un riavvio scelto da te.","Prerequisiti",MessageBoxButton.YesNo) == MessageBoxResult.Yes) await Execute("prerequisites");
            });
            Add(actions,"Configura Ubuntu", async () => await Execute("account"));
            Add(actions,"Installa / migra", async () => {
                var selected = distro.SelectedItem as Candidate;
                if (selected == null || !selected.Compatible) { MessageBox.Show(this,"Seleziona una distribuzione compatibile."); return; }
                if (MessageBox.Show(this,"Installare in " + selected.Name + "? Se Studio è già gestito in questa distro, verrà migrato mantenendo progetti e preferenze.","Riepilogo",MessageBoxButton.YesNo) == MessageBoxResult.Yes) await Execute("install",selected.Name);
            });
            Add(actions,"Aggiorna / ripara", async () => await Execute("update"));
            Add(actions,"Disinstalla", async () => {
                if (MessageBox.Show(this,"Rimuovere Studio conservando progetti, preferenze, WSL e la distro?","Disinstalla",MessageBoxButton.YesNo) == MessageBoxResult.Yes) await Execute("uninstall");
            });
            Add(actions,"Apri Studio", async () => await Execute("launch"));
            cancel.Click += (s,e) => { if(cancelPath!=null) { File.WriteAllText(cancelPath,"cancel");cancel.IsEnabled=false;log.AppendText("Annullamento richiesto prima dell’installazione.\n"); } };
            actions.Children.Add(cancel);
            Add(actions,"Esporta diagnosi", () => {
                var dialog=new Microsoft.Win32.SaveFileDialog { FileName="ASE-Studio-diagnostics.txt", Filter="Text files|*.txt" };
                if(dialog.ShowDialog(this)==true) File.WriteAllText(dialog.FileName,"ASE Studio installer diagnostics\n"+log.Text,Encoding.UTF8);
                return Task.CompletedTask;
            });
            panel.Children.Add(progress);
            panel.Children.Add(log);
            Closing += (s,e) => { if (busy) { e.Cancel = true; MessageBox.Show(this,"Attendi la conclusione dell’operazione per lasciare l’installazione in uno stato consistente."); } };
            Loaded += async (s,e) => {
                if (savedAction == "launch") { await Execute("launch"); if (!log.Text.Contains("ERRORE")) Close(); else { ShowInTaskbar=true; Opacity=1; WindowState=WindowState.Normal; } }
                else if (savedAction == "uninstall") {
                    if (MessageBox.Show(this,"Disinstallare Studio mantenendo i dati?","ASE Studio",MessageBoxButton.YesNo) == MessageBoxResult.Yes) await Execute("uninstall");
                } else await Discover();
            };
        }
        void Add(Panel panel,string title,Func<Task> callback) {
            var button=new Button { Content=title, Padding=new Thickness(10,6,10,6), Margin=new Thickness(0,0,8,10) };
            button.Click += async (s,e) => await callback(); buttons.Add(button); panel.Children.Add(button);
        }
        static string Quote(string value) {
            // CommandLineToArgvW quoting, including trailing backslashes and embedded quotes.
            var b = new StringBuilder("\""); int slashes=0;
            foreach(char c in value) {
                if(c=='\\') { slashes++; continue; }
                if(c=='"') { b.Append('\\',slashes*2+1); b.Append(c); slashes=0; continue; }
                b.Append('\\',slashes); slashes=0; b.Append(c);
            }
            b.Append('\\',slashes*2); return b.Append('"').ToString();
        }
        async Task<string> Execute(string action,string distribution="") {
            if (busy) return null;
            busy=true; progress.IsIndeterminate=true; foreach(var b in buttons)b.IsEnabled=false;
            cancelPath=Path.Combine(Path.GetTempPath(),"ase-cancel-"+Guid.NewGuid().ToString("N"));
            cancel.IsEnabled=action=="discover" || action=="install" || action=="update";
            var login=user.Text; var result=new StringBuilder();
            Mutex operationLock=null; bool ownsLock=false;
            try {
                if(action!="launch" && action!="discover") {
                    operationLock=new Mutex(false,"Global\\ASEStudioSetup-"+WindowsIdentity.GetCurrent().User.Value);
                    try { ownsLock=operationLock.WaitOne(0); } catch(AbandonedMutexException) { ownsLock=true; }
                    if(!ownsLock) { log.AppendText("Un’altra operazione di installazione è in corso.\n");return null; }
                }
                var folder=Program.PayloadRoot;
                var ps=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32","WindowsPowerShell","v1.0","powershell.exe");
                string[] args={"-NoProfile","-ExecutionPolicy","Bypass","-File",Path.Combine(folder,"windows-setup.ps1"),"-Action",action,"-Distro",distribution,"-LinuxUser",login,"-CancelFile",cancelPath};
                int code=await Task.Run(() => {
                    using(var process=new Process()) {
                        process.StartInfo=new ProcessStartInfo(ps,string.Join(" ",args.Select(Quote))) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8,WorkingDirectory=folder };
                        process.OutputDataReceived+=(s,e)=> { if(e.Data!=null) { lock(result)result.AppendLine(e.Data); if(action!="discover" && action!="launch") Dispatcher.BeginInvoke(new Action(()=> {if(e.Data=="ASE_PHASE:commit") { cancel.IsEnabled=false;log.AppendText("Verifica e installazione: attendi il completamento.\n"); } else log.AppendText(e.Data+Environment.NewLine);log.ScrollToEnd();})); } };
                        process.ErrorDataReceived+=(s,e)=> { if(e.Data!=null && action!="launch") Dispatcher.BeginInvoke(new Action(()=>log.AppendText(e.Data+Environment.NewLine))); };
                        process.Start();process.BeginOutputReadLine();process.BeginErrorReadLine();process.WaitForExit();return process.ExitCode;
                    }
                });
                if(code==2) { log.AppendText("Operazione annullata.\n");return null; }
                if(code!=0) { log.AppendText("ERRORE: operazione non completata. Correggi il problema indicato e riprova.\n");return null; }
                return result.ToString();
            } catch(Exception ex) { log.AppendText("ERRORE: "+ex.Message+"\n");return null; }
            finally { if(ownsLock)operationLock.ReleaseMutex();if(operationLock!=null)operationLock.Dispose();busy=false;progress.IsIndeterminate=false;cancel.IsEnabled=false;if(cancelPath!=null)File.Delete(cancelPath);cancelPath=null;foreach(var b in buttons)b.IsEnabled=true; }
        }
        async Task Discover() {
            string json=await Execute("discover"); if(json==null)return;
            try {
                var serializer=new JavaScriptSerializer();
                var values=string.IsNullOrWhiteSpace(json)?new Candidate[0]:(json.TrimStart().StartsWith("[")?serializer.Deserialize<Candidate[]>(json):new[]{serializer.Deserialize<Candidate>(json)});
                distro.ItemsSource=values;
                var eligible=values.Where(x=>x.Compatible).ToArray();
                distro.SelectedItem=eligible.Length==1?eligible[0]:eligible.FirstOrDefault(x=>x.IsDefault);
                log.AppendText(eligible.Length==0?"Nessuna distro compatibile: prepara WSL o correggi i problemi indicati.\n":eligible.Length==1?"Distribuzione selezionata automaticamente: "+eligible[0].Name+"\n":"Più distro compatibili: scegli quella da usare.\n");
            } catch(Exception ex) { log.AppendText("ERRORE nella diagnosi: "+ex.Message+"\n"); }
        }
    }
    static class Program {
        internal static string PayloadRoot;
        static int EnablePrerequisites() {
            if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return 1;
            var system=Environment.GetFolderPath(Environment.SpecialFolder.System);
            var commands=new[] {
                new[]{"dism.exe","/Online /Enable-Feature /FeatureName:Microsoft-Windows-Subsystem-Linux /All /NoRestart"},
                new[]{"dism.exe","/Online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart"},
                new[]{"wsl.exe","--install --no-distribution"}
            };
            bool restart=false;
            foreach(var command in commands) {
                if(restart && command[0]=="wsl.exe") break;
                using(var process=Process.Start(new ProcessStartInfo(Path.Combine(system,command[0]),command[1]) { UseShellExecute=false,CreateNoWindow=true })) {
                    process.WaitForExit();
                    if(process.ExitCode!=0 && process.ExitCode!=3010) return process.ExitCode;
                    if(process.ExitCode==3010) restart=true;
                }
            }
            return restart?3010:0;
        }
        [STAThread] static int Main(string[] args) {
            if(args.Contains("--enable-prerequisites")) return EnablePrerequisites();
            try {
                PayloadRoot=Path.Combine(Path.GetTempPath(),"ase-bootstrap-"+Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(PayloadRoot);
                var assembly=Assembly.GetExecutingAssembly();
                foreach(var name in new[]{"windows-setup.ps1","install-release.ps1","release-public.xml","LICENSE"}) {
                    using(var source=assembly.GetManifestResourceStream("payload."+name))
                    using(var target=File.Create(Path.Combine(PayloadRoot,name))) source.CopyTo(target);
                }
                File.Copy(assembly.Location,Path.Combine(PayloadRoot,"ASEStudioSetup.exe"));
                var action=args.Contains("--launch")?"launch":args.Contains("--uninstall")?"uninstall":"discover";
                return new Application().Run(new SetupWindow(action));
            } catch(Exception ex) { MessageBox.Show("Impossibile avviare l’installer: "+ex.Message,"ASE Studio");return 1; }
            finally { if(PayloadRoot!=null && Directory.Exists(PayloadRoot)) { try { Directory.Delete(PayloadRoot,true); } catch(IOException) {} } }
        }
    }
}
