import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?
    private var content: WKWebView?

    private func operatorToken() -> String? {
        let env = ProcessInfo.processInfo.environment
        let root = env["SEEDING_DATA_DIR"] ?? (FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Marketing Seeding OS").path)
        let path = URL(fileURLWithPath: root).appendingPathComponent("operator-token")
        guard let value = try? String(contentsOf: path, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), value.count >= 32 else { return nil }
        return value
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let token = operatorToken(),
              let encoded = try? JSONSerialization.data(withJSONObject: [token]),
              let json = String(data: encoded, encoding: .utf8) else { return }
        // The token stays in the local app's sessionStorage only. It is never
        // rendered, logged, persisted by Swift, or sent outside loopback.
        let script = """
        (() => {
          const token = JSON.parse(\(json))[0];
          fetch('/api/operator/session', { headers: { authorization: 'Bearer ' + token, 'x-agentic-actor': 'dashboard-operator' }})
            .then(response => { if (!response.ok) throw new Error('operator session rejected'); sessionStorage.setItem('seedingOperatorToken', token); window.dispatchEvent(new CustomEvent('seeding-operator-session-ready')); })
            .catch(() => sessionStorage.removeItem('seedingOperatorToken'));
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = NSMenu(title: "Marketing Seeding OS")
        appItem.submenu?.addItem(withTitle: "Thoát", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        mainMenu.addItem(appItem)
        let editItem = NSMenuItem()
        editItem.submenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"), ("Paste", #selector(NSText.paste(_:)), "v"), ("Select All", #selector(NSText.selectAll(_:)), "a")] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = [.command]
            editItem.submenu?.addItem(item)
        }
        mainMenu.addItem(editItem)
        let windowItem = NSMenuItem()
        windowItem.submenu = NSMenu(title: "Window")
        mainMenu.addItem(windowItem)
        NSApp.mainMenu = mainMenu

        let content = WKWebView(frame: .zero)
        content.navigationDelegate = self
        content.autoresizingMask = [.width, .height]
        content.load(URLRequest(url: URL(string: CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:4321/")!))

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Marketing Seeding OS"
        window.center()
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        self.window = window
        self.content = content
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
