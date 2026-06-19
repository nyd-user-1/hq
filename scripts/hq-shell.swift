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
    var pendingPath: String?       // a deep-link tap that arrived before the webview was ready

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
                if let p = self.pendingPath {              // a deep-link tap is waiting
                    self.pendingPath = nil
                    self.loadPath(p)
                } else {
                    self.webView.load(URLRequest(url: url))
                }
                self.fetchAndIndex()                       // publish HQ content to Spotlight
            }
        }
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        startServer()
        buildWindow()
        waitForServerThenLoad()
        setupStatusItem()
        installGlobalHotKey()
        AppDelegate.warmIcons()      // precompute per-type Spotlight icons (main thread)
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

    // --- Spotlight: publish HQ content (memory/todo/transcript/commit/note) --
    // Driven by the server's /api/spotlight-index, so adding a content type is a
    // server-only change. Each item's CoreSpotlight uniqueIdentifier IS its /go
    // open path, so a tap navigates straight to it.
    func fetchAndIndex() {
        guard let url = URL(string: "http://localhost:\(PORT)/api/spotlight-index") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rows = obj["items"] as? [[String: Any]] else { return }
            var items: [CSSearchableItem] = []
            for r in rows {
                guard let path = r["path"] as? String, let title = r["title"] as? String else { continue }
                let type = (r["type"] as? String) ?? "item"
                let attr = CSSearchableItemAttributeSet(contentType: .text)
                attr.title = title
                attr.displayName = title
                attr.contentDescription = (r["snippet"] as? String) ?? ""
                attr.keywords = ["hq", type]
                if let icon = AppDelegate.icon(for: type) { attr.thumbnailData = icon }
                items.append(CSSearchableItem(uniqueIdentifier: path,          // = the /go path
                                              domainIdentifier: "com.nysgpt.hq.\(type)",
                                              attributeSet: attr))
            }
            let index = CSSearchableIndex.default()
            index.deleteAllSearchableItems { _ in          // wipe everything HQ indexed, then republish
                index.indexSearchableItems(items) { err in
                    NSLog("HQ: Spotlight indexed \(items.count) items\(err != nil ? " (error: \(err!))" : "")")
                }
            }
        }.resume()
    }

    // --- per-type Spotlight icons (rounded colored tile + letter) ------------
    static var iconCache: [String: Data] = [:]
    static func warmIcons() { for t in ["note", "memory", "todo", "transcript", "commit"] { _ = icon(for: t) } }
    static func icon(for type: String) -> Data? {
        if let c = iconCache[type] { return c }
        let (letter, color): (String, NSColor) = {
            switch type {
            case "memory":     return ("M", NSColor(red: 0.39, green: 0.40, blue: 0.95, alpha: 1)) // indigo
            case "todo":       return ("T", NSColor(red: 0.06, green: 0.72, blue: 0.51, alpha: 1)) // emerald
            case "transcript": return ("S", NSColor(red: 0.05, green: 0.65, blue: 0.91, alpha: 1)) // sky
            case "commit":     return ("C", NSColor(red: 0.96, green: 0.62, blue: 0.07, alpha: 1)) // amber
            default:           return ("N", NSColor(red: 0.16, green: 0.16, blue: 0.18, alpha: 1)) // note: zinc
            }
        }()
        let data = makeIcon(letter, color)
        if let d = data { iconCache[type] = d }
        return data
    }
    static func makeIcon(_ letter: String, _ color: NSColor) -> Data? {
        let side: CGFloat = 128
        let img = NSImage(size: NSSize(width: side, height: side))
        img.lockFocus()
        color.setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: side, height: side), xRadius: 28, yRadius: 28).fill()
        // "hq" is the hero — large, centered
        let hqAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.boldSystemFont(ofSize: 54),
            .foregroundColor: NSColor.white,
        ]
        let hq = "hq" as NSString
        let hqSize = hq.size(withAttributes: hqAttrs)
        hq.draw(at: NSPoint(x: (side - hqSize.width) / 2, y: (side - hqSize.height) / 2 + 4), withAttributes: hqAttrs)
        // the type letter is a small accent, lower-LEFT (the macOS app badge sits lower-right)
        let lAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.boldSystemFont(ofSize: 30),
            .foregroundColor: NSColor.white.withAlphaComponent(0.85),
        ]
        (letter as NSString).draw(at: NSPoint(x: 12, y: 8), withAttributes: lAttrs)
        img.unlockFocus()
        guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }

    // --- open a deep-linked item (Spotlight tap or hq://go?...) --------------
    func loadPath(_ path: String) {
        if let url = URL(string: "http://localhost:\(PORT)\(path)") { webView.load(URLRequest(url: url)) }
    }
    func openPath(_ path: String) {
        showWindow()
        if serverUp && webView != nil { loadPath(path) } else { pendingPath = path }
    }

    // Spotlight result tapped -> navigate to its /go path (= the uniqueIdentifier).
    func application(_ application: NSApplication, continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        if userActivity.activityType == CSSearchableItemActionType,
           let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            openPath(id)
            return true
        }
        return false
    }

    // hq://go?type=&ref=  URL scheme (automation / Shortcuts hook).
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "hq" && url.host == "go" {
            openPath("/go?\(url.query ?? "")")
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
