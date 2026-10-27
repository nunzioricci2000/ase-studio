// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-10-28: native macOS window for the packaged stdlib backend.
import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit

final class StudioApplication: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let name = "ASE Studio di Nunzio"
    var backend: Process?
    var origin: URL?
    var mainWindow: NSWindow?
    var mainView: WKWebView?
    var popups: [NSWindow: WKWebView] = [:]
    var downloads: [WKDownload] = []
    var output = ""
    var errors = ""
    var closing = false
    var decidingClose = false
    var allowTermination = false
    var pendingTermination = false
    var testStarted = false
    var testPhase = 0
    var testFinished = false
    var testDownloadFinished = false
    let arguments = CommandLine.arguments
    var testURL: URL? { argument("--test-url").flatMap(URL.init(string:)) }
    var testingApplication: Bool { arguments.contains("--smoke-application") }
    var testing: Bool { testURL != nil || testingApplication }
    var testOutput: URL? { argument("--test-output").map { URL(fileURLWithPath: $0, isDirectory: true) } }

    func argument(_ flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let path = argument("--open-with") {
            chooseApplication(URL(fileURLWithPath: path))
            return
        }
        installMenu()
        if let url = testURL {
            guard url.scheme == "http", url.host == "127.0.0.1", url.port != nil, testOutput != nil else {
                fail("Native tests require a loopback URL and an output directory")
                return
            }
            do {
                try FileManager.default.createDirectory(at: testOutput!, withIntermediateDirectories: true)
                try Data("native upload fixture".utf8).write(to: testOutput!.appendingPathComponent("upload.txt"))
            } catch { fail(error.localizedDescription); return }
            origin = URL(string: "http://127.0.0.1:\(url.port!)")
            showWindow(url)
        } else {
            startBackend()
        }
        if testing {
            Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
                guard let self = self, !self.testFinished else { timer.invalidate(); return }
                self.pollTest()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
                if let self = self, !self.testFinished { self.fail("Native webview test timed out") }
            }
        }
    }

    func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(title: name, action: nil, keyEquivalent: "")
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"),
                                       ("Copy", "copy:", "c"), ("Paste", "paste:", "v"),
                                       ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let redo = NSMenuItem(title: "Redo", action: Selector("redo:"), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.insertItem(redo, at: 1)
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    func startBackend() {
        guard let resources = Bundle.main.resourceURL else { fail("Application resources are missing"); return }
        let engine = resources.appendingPathComponent("engine")
        let process = Process()
        process.executableURL = engine.appendingPathComponent("python/bin/python3.10")
        process.arguments = [resources.appendingPathComponent("ase_studio/portable.py").path,
                             "--server", "--engine", engine.path]
        process.currentDirectoryURL = resources
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "PYTHONPATH")
        env["PYTHONHOME"] = engine.appendingPathComponent("python").path
        env["PYTHONNOUSERSITE"] = "1"
        env["DYLD_LIBRARY_PATH"] = engine.appendingPathComponent("python/lib").path
        env["ASE_STUDIO_NATIVE_HELPER"] = Bundle.main.executableURL?.path
        process.environment = env
        let stdout = Pipe(), stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.readOutput(String(decoding: data, as: UTF8.self)) }
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.errors = String((self.errors + String(decoding: data, as: UTF8.self)).suffix(8192))
            }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.closing { self.finishQuit() }
                else { self.fail("The backend stopped (\(process.terminationStatus)).\n\(self.errors)") }
            }
        }
        backend = process
        do { try process.run() }
        catch { fail("Could not launch the packaged backend: \(error.localizedDescription)"); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { [weak self] in
            if let self = self, self.origin == nil, !self.closing {
                self.fail("The backend did not become ready.\n\(self.errors)")
            }
        }
    }

    func readOutput(_ text: String) {
        output += text
        while let newline = output.firstIndex(of: "\n") {
            let line = String(output[..<newline])
            output.removeSubrange(...newline)
            let prefix = "ASE Studio: "
            if origin == nil, line.hasPrefix(prefix), let url = URL(string: String(line.dropFirst(prefix.count))),
               url.scheme == "http", url.host == "127.0.0.1", url.port != nil {
                origin = url
                showWindow(url)
            }
        }
        output = String(output.suffix(8192))
    }

    func createWindow(_ configuration: WKWebViewConfiguration, main: Bool) -> (NSWindow, WKWebView) {
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        let webview = WKWebView(frame: .zero, configuration: configuration)
        webview.uiDelegate = self
        webview.navigationDelegate = self
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: main ? 1440 : 1050, height: main ? 900 : 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = main ? name : "\(name) — Memory"
        window.minSize = NSSize(width: main ? 900 : 650, height: main ? 600 : 400)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = webview
        window.center()
        window.makeKeyAndOrderFront(nil)
        return (window, webview)
    }

    func showWindow(_ url: URL) {
        let (window, webview) = createWindow(WKWebViewConfiguration(), main: true)
        mainWindow = window
        mainView = webview
        webview.load(URLRequest(url: url))
        NSApp.activate(ignoringOtherApps: true)
    }

    func internalURL(_ url: URL) -> Bool {
        if url.absoluteString == "about:blank" { return true }
        if url.scheme == "blob", let embedded = URL(string: String(url.absoluteString.dropFirst(5))) {
            return internalURL(embedded)
        }
        return url.scheme == origin?.scheme && url.host == origin?.host && url.port == origin?.port
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if !internalURL(url) {
            if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        } else { decisionHandler(action.shouldPerformDownload ? .download : .allow) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard action.targetFrame == nil, let url = action.request.url, internalURL(url) else { return nil }
        let (window, view) = createWindow(configuration, main: false)
        popups[window] = view
        return view
    }

    func webViewDidClose(_ webView: WKWebView) { webView.window?.close() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail("The webview process stopped unexpectedly.")
    }
    func windowWillClose(_ notification: Notification) {
        if let window = notification.object as? NSWindow { popups.removeValue(forKey: window) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        if testURL != nil { completionHandler([testOutput!.appendingPathComponent("upload.txt")]); return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self; downloads.append(download)
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self; downloads.append(download)
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        if testURL != nil { completionHandler(testOutput!.appendingPathComponent("download.txt")); return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let destination = panel.url else { completionHandler(nil); return }
        do {
            if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
            completionHandler(destination)
        } catch { completionHandler(nil); showError(error.localizedDescription) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        downloads.removeAll { $0 === download }
        testDownloadFinished = true
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeAll { $0 === download }
        if (error as NSError).code != NSURLErrorCancelled { showError(error.localizedDescription) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender !== mainWindow { return true }
        requestClose()
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowTermination { return .terminateNow }
        pendingTermination = true
        requestClose()
        return .terminateLater
    }
    func requestClose() {
        guard !closing, !decidingClose else { return }
        decidingClose = true
        guard let view = mainView else { stopBackend(); return }
        view.evaluateJavaScript("Boolean(window.aseHasUnsavedChanges?.())") { [weak self] value, _ in
            guard let self = self else { return }
            if value as? Bool == true {
                let alert = NSAlert()
                alert.messageText = "Unsaved changes"
                alert.informativeText = "Some changes have not been saved. Keep Studio open to save them, or discard them and quit."
                alert.addButton(withTitle: "Keep Open")
                alert.addButton(withTitle: "Discard and Quit")
                if alert.runModal() != .alertSecondButtonReturn {
                    self.decidingClose = false
                    if self.pendingTermination { self.pendingTermination = false; NSApp.reply(toApplicationShouldTerminate: false) }
                    return
                }
            }
            self.stopBackend()
        }
    }
    func stopBackend() {
        guard !closing else { return }
        closing = true
        mainView?.stopLoading()
        for window in Array(popups.keys) { window.close() }
        guard let process = backend, process.isRunning else { finishQuit(); return }
        if let url = origin?.appendingPathComponent("api/shutdown") {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = 10
            URLSession.shared.dataTask(with: request).resume()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            if process.isRunning { process.terminate() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self?.finishQuit() }
        }
    }
    func finishQuit() {
        allowTermination = true
        if pendingTermination { NSApp.reply(toApplicationShouldTerminate: true) }
        else { NSApp.terminate(nil) }
    }
    func showError(_ message: String) {
        if testing { fail(message); return }
        let alert = NSAlert()
        alert.messageText = name
        alert.informativeText = message
        alert.runModal()
    }
    func fail(_ message: String) {
        fputs(message + "\n", stderr)
        if testing { backend?.terminate(); exit(1) }
        showError(message)
        stopBackend()
    }

    func chooseApplication(_ source: URL) {
        NSApp.setActivationPolicy(.accessory)
        let panel = NSOpenPanel()
        panel.title = "Open \(source.lastPathComponent) with"
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.allowedContentTypes = [.applicationBundle]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let application = panel.url else { exit(0) }
        NSWorkspace.shared.open([source], withApplicationAt: application, configuration: .init()) { _, error in
            DispatchQueue.main.async {
                if let error = error { self.showError(error.localizedDescription); exit(1) }
                exit(0)
            }
        }
    }

    func pollTest() {
        guard let view = mainView else { return }
        if testingApplication {
            view.evaluateJavaScript("typeof window.aseHasUnsavedChanges === 'function' && !!document.querySelector('.monaco-editor')") { [weak self] value, _ in
                guard let self = self, value as? Bool == true, !self.testFinished else { return }
                self.testFinished = true
                print("PASS packaged native frontend")
                self.stopBackend()
            }
            return
        }
        view.evaluateJavaScript("JSON.stringify({ready:!!window.harness?.ready,done:!!window.harness?.done,error:window.testError,results:window.harness?.results,upload:window.nativeUpload})") { [weak self] value, error in
            guard let self = self, error == nil, let text = value as? String,
                  let data = text.data(using: .utf8),
                  let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            if let error = state["error"] as? String { self.fail(error); return }
            if state["ready"] as? Bool == true, !self.testStarted {
                self.testStarted = true
                view.evaluateJavaScript("window.runEditorTests().catch(e=>window.testError=String(e)); 'started'")
            }
            guard state["done"] as? Bool == true else { return }
            if self.testPhase == 0 {
                for result in state["results"] as? [String] ?? [] { print("PASS macOS WebKit: \(result)") }
                self.testPhase = 1
                view.evaluateJavaScript("window.nativePopup=window.open('about:blank','native-popup-test'); 'opened'")
            } else if self.testPhase == 1, self.popups.count == 1 {
                print("PASS native memory popup creation")
                self.testPhase = 2
                view.evaluateJavaScript("window.nativePopup.close(); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['native download fixture'],{type:'text/plain'})); a.download='download.txt'; a.click(); 'download'")
            } else if self.testPhase == 2, self.popups.isEmpty, self.testDownloadFinished {
                do {
                    let downloaded = try String(contentsOf: self.testOutput!.appendingPathComponent("download.txt"), encoding: .utf8)
                    guard downloaded == "native download fixture" else { self.fail("Incorrect exported bytes"); return }
                } catch { self.fail(error.localizedDescription); return }
                print("PASS native popup closure and export")
                self.testPhase = 3
                view.evaluateJavaScript("const f=document.createElement('input'); f.type='file'; f.onchange=()=>f.files[0].text().then(t=>window.nativeUpload=t); document.body.append(f); f.click(); 'upload'")
            } else if self.testPhase == 3, state["upload"] as? String == "native upload fixture" {
                print("PASS native file selection")
                self.testFinished = true
                self.stopBackend()
            }
        }
    }
}

setbuf(stdout, nil)
let application = NSApplication.shared
let delegate = StudioApplication()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
