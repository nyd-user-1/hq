// hq-shell.swift — a native macOS window (NSWindow + WKWebView) that hosts the
// self-contained offline HQ. It starts the bundled Next standalone server as a
// CHILD process on launch and TERMINATES it on quit, so nothing leaks.
//
// Compiled into HQ.app/Contents/MacOS/hq by scripts/make-macos-app-native.sh.
import AppKit
import WebKit
import Carbon.HIToolbox   // RegisterEventHotKey — a true global hotkey, no a11y permission
import CoreSpotlight      // publish notes to system Spotlight (⌘Space)
import UniformTypeIdentifiers

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
    var statusItem: NSStatusItem!
    var hotKeyRef: EventHotKeyRef?
    var serverUp = false
    var pendingNoteName: String?   // a Spotlight tap that arrived before the webview was ready

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
        // Default size: a comfortable fraction of the screen, capped, with margins
        // so it never fills a 13" Air edge-to-edge. Centered. The autosave name
        // remembers the user's own resize after first launch.
        let vis = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w = min(1320, vis.width * 0.82)
        let h = min(860, vis.height * 0.88)
        let rect = NSRect(x: 0, y: 0, width: w, height: h)
        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "HQ"
        window.isReleasedWhenClosed = false   // closing hides; HQ stays in the menu bar
        window.contentMinSize = NSSize(width: 940, height: 620)
        window.setFrameAutosaveName("HQWindow")   // new key so the tuned default applies fresh
        window.center()
        window.delegate = self
        webView = WKWebView(frame: rect, configuration: WKWebViewConfiguration())
        webView.autoresizingMask = [.width, .height]
        webView.pageZoom = max(0.5, min(3.0, (UserDefaults.standard.object(forKey: "hqZoom") as? Double) ?? 1.0))
        webView.addObserver(self, forKeyPath: "title", options: .new, context: nil)
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
    }

    // Mirror the web page's <title> into the native title bar (falls back to "HQ").
    override func observeValue(forKeyPath keyPath: String?, of object: Any?,
                               change: [NSKeyValueChangeKey: Any]?,
                               context: UnsafeMutableRawPointer?) {
        if keyPath == "title" {
            let t = webView.title ?? ""
            window.title = t.isEmpty ? "HQ" : t
        }
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
            DispatchQueue.main.async {
                self.serverUp = true
                if let n = self.pendingNoteName {          // a Spotlight tap is waiting
                    self.pendingNoteName = nil
                    self.loadNote(n)
                } else {
                    self.webView.load(URLRequest(url: url))
                }
            }
        }
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        startServer()
        buildWindow()
        waitForServerThenLoad()
        setupStatusItem()
        installGlobalHotKey()
        indexNotes()                 // publish ~/.claude/hq/notes to system Spotlight
        NSApp.activate(ignoringOtherApps: true)
    }

    // Stay alive in the menu bar when the window is closed (ambient app).
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    // Click the Dock icon with no window open -> re-show it.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow() }
        return true
    }

    // --- menu-bar item -------------------------------------------------------
    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            b.title = "hq"
            b.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
            b.toolTip = "HQ — click to show/hide  (⌃⌥⌘H)"
            b.target = self
            b.action = #selector(statusClicked(_:))
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
    }

    @objc func statusClicked(_ sender: Any?) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let m = NSMenu()
            m.addItem(withTitle: "Show HQ", action: #selector(showWindow), keyEquivalent: "")
            m.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "")
            m.addItem(.separator())
            m.addItem(withTitle: "Quit HQ", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            statusItem.menu = m
            statusItem.button?.performClick(nil)   // open it
            statusItem.menu = nil                   // clear so left-click toggles again
        } else {
            toggleWindow()
        }
    }

    // --- summon / dismiss ----------------------------------------------------
    @objc func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func toggleWindow() {
        if NSApp.isActive && window.isVisible && window.isKeyWindow {
            NSApp.hide(nil)
        } else {
            showWindow()
        }
    }

    // --- global hotkey: ⌃⌥⌘H (no Accessibility permission needed) -------------
    func installGlobalHotKey() {
        let id = EventHotKeyID(signature: OSType(0x48514B59), id: 1)  // 'HQKY'
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, _) -> OSStatus in
            DispatchQueue.main.async { (NSApp.delegate as? AppDelegate)?.toggleWindow() }
            return noErr
        }, 1, &spec, nil, nil)
        let mods = UInt32(controlKey | optionKey | cmdKey)
        RegisterEventHotKey(UInt32(kVK_ANSI_H), mods, id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    func applicationWillTerminate(_ note: Notification) {
        webView?.removeObserver(self, forKeyPath: "title")
        server?.terminate()   // no leaked background server
    }

    @objc func reload() { webView?.reload() }

    // --- page zoom (⌘+ / ⌘- / ⌘0), persisted across launches ----------------
    @objc func zoomIn()    { setZoom(webView.pageZoom + 0.1) }
    @objc func zoomOut()   { setZoom(webView.pageZoom - 0.1) }
    @objc func zoomReset() { setZoom(1.0) }
    func setZoom(_ z: CGFloat) {
        let clamped = max(0.5, min(3.0, z))
        webView.pageZoom = clamped
        UserDefaults.standard.set(Double(clamped), forKey: "hqZoom")
    }

    // --- Spotlight: publish ~/.claude/hq/notes/*.md -------------------------
    static let noteDomain = "com.nysgpt.hq.notes"

    // Title = first non-empty body line after the --- frontmatter --- (mirrors
    // lib/notes.ts noteTitle); body used for the searchable snippet.
    func noteTitleAndBody(_ content: String) -> (String, String) {
        var body = content
        if content.hasPrefix("---") {
            let lines = content.components(separatedBy: "\n")
            var i = 1
            while i < lines.count && lines[i] != "---" { i += 1 }
            if i < lines.count { body = lines[(i + 1)...].joined(separator: "\n") }
        }
        body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = body.split(separator: "\n").first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
            .map { String($0.prefix(60)) } ?? "note"
        return (title, body)
    }

    func indexNotes() {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".claude/hq/notes")
        let fm = FileManager.default
        let names = (try? fm.contentsOfDirectory(atPath: dir)) ?? []
        var items: [CSSearchableItem] = []
        for name in names where name.hasSuffix(".md") {
            let full = (dir as NSString).appendingPathComponent(name)
            guard let content = try? String(contentsOfFile: full, encoding: .utf8) else { continue }
            let (title, body) = noteTitleAndBody(content)
            let attr = CSSearchableItemAttributeSet(contentType: .text)
            attr.title = title
            attr.displayName = title
            attr.contentDescription = String(body.prefix(500))
            attr.keywords = ["hq", "note"]
            items.append(CSSearchableItem(uniqueIdentifier: name,
                                          domainIdentifier: AppDelegate.noteDomain,
                                          attributeSet: attr))
        }
        let index = CSSearchableIndex.default()
        // wipe the domain first so deleted notes don't linger, then republish
        index.deleteSearchableItems(withDomainIdentifiers: [AppDelegate.noteDomain]) { _ in
            index.indexSearchableItems(items) { err in
                NSLog("HQ: Spotlight indexed \(items.count) notes\(err != nil ? " (error: \(err!))" : "")")
            }
        }
    }

    // --- open a note (from a Spotlight tap or hq://note/<name>) --------------
    func loadNote(_ name: String) {
        var c = URLComponents()
        c.scheme = "http"; c.host = "localhost"; c.port = PORT; c.path = "/search"
        c.queryItems = [URLQueryItem(name: "openNote", value: name)]
        if let url = c.url { webView.load(URLRequest(url: url)) }
    }

    func openNote(_ name: String) {
        showWindow()
        if serverUp && webView != nil { loadNote(name) } else { pendingNoteName = name }
    }

    // Spotlight result tapped -> open that note.
    func application(_ application: NSApplication, continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        if userActivity.activityType == CSSearchableItemActionType,
           let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            openNote(id)
            return true
        }
        return false
    }

    // hq://note/<name> URL scheme (automation / Shortcuts hook).
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "hq" && url.host == "note" {
            let name = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
            if !name.isEmpty { openNote(name) }
        }
    }
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

// View menu: real ⌘+ / ⌘- / ⌘0 page zoom.
let viewItem = NSMenuItem(); mainMenu.addItem(viewItem)
let viewMenu = NSMenu(title: "View")
let zin = NSMenuItem(title: "Zoom In", action: #selector(AppDelegate.zoomIn), keyEquivalent: "+"); zin.target = delegate
let zout = NSMenuItem(title: "Zoom Out", action: #selector(AppDelegate.zoomOut), keyEquivalent: "-"); zout.target = delegate
let zreset = NSMenuItem(title: "Actual Size", action: #selector(AppDelegate.zoomReset), keyEquivalent: "0"); zreset.target = delegate
viewMenu.addItem(zin); viewMenu.addItem(zout); viewMenu.addItem(zreset)
viewItem.submenu = viewMenu

app.mainMenu = mainMenu

app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
