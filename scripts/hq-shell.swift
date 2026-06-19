// hq-shell.swift — a native macOS window (NSWindow + WKWebView) that hosts the
// self-contained offline HQ. It starts the bundled Next standalone server as a
// CHILD process on launch and TERMINATES it on quit, so nothing leaks.
//
// Compiled into HQ.app/Contents/MacOS/hq by scripts/make-macos-app-native.sh.
import AppKit
import WebKit

let PORT = 3009
let URLSTR = "http://localhost:\(PORT)/"

func resolveNode() -> String {
    let fm = FileManager.default
    for c in ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"] {
        if fm.isExecutableFile(atPath: c) { return c }
    }
    return "/usr/local/bin/node"
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?

    func standaloneDir() -> String {
        (Bundle.main.resourcePath ?? ".") + "/standalone"
    }

    // Spawn the bundled standalone server. GUI apps get a minimal PATH, so we
    // resolve node by absolute path and pass the env explicitly.
    func startServer() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: resolveNode())
        p.arguments = ["server.js"]
        p.currentDirectoryURL = URL(fileURLWithPath: standaloneDir())
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(PORT)
        env["HOSTNAME"] = "127.0.0.1"
        env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
        p.environment = env
        do { try p.run(); server = p } catch { NSLog("HQ: server start failed: \(error)") }
    }

    func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1440, height: 900)
        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "HQ"
        window.setFrameAutosaveName("HQMainWindow")
        window.center()
        window.delegate = self
        webView = WKWebView(frame: rect, configuration: WKWebViewConfiguration())
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
    }

    // Poll the server until it answers, then load it (avoids a flash of error
    // while node is still booting).
    func waitForServerThenLoad() {
        guard let url = URL(string: URLSTR) else { return }
        DispatchQueue.global().async {
            for _ in 0..<60 {
                var req = URLRequest(url: url); req.timeoutInterval = 1.5
                let sem = DispatchSemaphore(value: 0); var ok = false
                URLSession.shared.dataTask(with: req) { _, resp, _ in
                    if let h = resp as? HTTPURLResponse, h.statusCode == 200 { ok = true }
                    sem.signal()
                }.resume()
                _ = sem.wait(timeout: .now() + 2)
                if ok { break }
                Thread.sleep(forTimeInterval: 0.4)
            }
            DispatchQueue.main.async { self.webView.load(URLRequest(url: url)) }
        }
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        startServer()
        buildWindow()
        waitForServerThenLoad()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ note: Notification) {
        server?.terminate()   // no leaked background server
    }

    @objc func reload() { webView?.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()

// Minimal native menu so ⌘R / ⌘H / ⌘Q behave like a real app.
let mainMenu = NSMenu()
let appItem = NSMenuItem(); mainMenu.addItem(appItem)
let appMenu = NSMenu()
let reloadItem = NSMenuItem(title: "Reload", action: #selector(AppDelegate.reload), keyEquivalent: "r")
reloadItem.target = delegate
appMenu.addItem(reloadItem)
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Hide HQ", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
appMenu.addItem(withTitle: "Quit HQ", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
app.mainMenu = mainMenu

app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
