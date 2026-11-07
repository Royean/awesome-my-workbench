import AppKit
import Security

let credentialService = "io.workbench.agentbridge"

func credentialCommand(_ command: String) -> Never {
    do {
        let input = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as? [String: String]
        guard let account = input?["account"], !account.isEmpty else { throw NSError(domain: credentialService, code: 1) }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: account
        ]
        var result: [String: Any] = ["ok": true]
        switch command {
        case "credential-store":
            guard let token = input?["token"], !token.isEmpty else { throw NSError(domain: credentialService, code: 2) }
            let value = Data(token.utf8)
            var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
            if status == errSecItemNotFound {
                var add = query
                add[kSecValueData as String] = value
                status = SecItemAdd(add as CFDictionary, nil)
            }
            guard status == errSecSuccess else { throw NSError(domain: credentialService, code: Int(status)) }
        case "credential-read":
            var read = query
            read[kSecReturnData as String] = true
            read[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(read as CFDictionary, &item)
            guard status == errSecSuccess, let bytes = item as? Data,
                  let token = String(data: bytes, encoding: .utf8) else { throw NSError(domain: credentialService, code: Int(status)) }
            result["token"] = token
        case "credential-delete":
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain: credentialService, code: Int(status)) }
        default:
            throw NSError(domain: credentialService, code: 3)
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
        exit(0)
    } catch {
        FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ["ok": false, "error": "钥匙串操作失败"]))
        exit(1)
    }
}

if let command = CommandLine.arguments.dropFirst().first, command.hasPrefix("credential-") { credentialCommand(command) }

final class BridgeApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var bridge: Process?
    private var buffer = ""
    private var window: NSWindow?
    private let serverField = NSTextField()
    private let codeField = NSTextField()
    private let nameField = NSTextField()
    private let infoLabel = NSTextField(wrappingLabelWithString: "配对后，从菜单添加允许 Agent 使用的项目目录。")
    private let statusLabel = NSMenuItem(title: "尚未连接", action: nil, keyEquivalent: "")
    private var config: [String: Any] = [:]
    private var pairing = false
    private var restartAfterExit = false
    private var activity: NSObjectProtocol?

    private var configDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WorkbenchAgentBridge", isDirectory: true)
    }
    private var configURL: URL { configDirectory.appendingPathComponent("config.json") }
    private var helperPath: String { Bundle.main.executablePath! }
    private var connectorPath: String { Bundle.main.resourceURL!.appendingPathComponent("connector/bridge.mjs").path }

    func applicationDidFinishLaunching(_ notification: Notification) {
        loadConfig()
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "◉ Agents"
        let menu = NSMenu()
        menu.addItem(statusLabel)
        menu.addItem(NSMenuItem.separator())
        for (title, action) in [
            ("连接工作台…", #selector(showSettings)), ("添加本机项目…", #selector(addProject)),
            ("启动同步", #selector(startBridge)), ("停止同步", #selector(stopBridge)),
            ("打开 AI Teams", #selector(openTeams)), ("打开开发任务", #selector(openTasks))
        ] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
            entry.target = self
            menu.addItem(entry)
        }
        menu.addItem(NSMenuItem.separator())
        let quit = NSMenuItem(title: "退出", action: #selector(quitApp), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        if config["deviceId"] as? String != nil { startBridge() } else { showSettings() }
    }

    private func loadConfig() {
        if let data = try? Data(contentsOf: configURL),
           let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { config = saved }
    }

    private func saveConfig() throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]).write(to: configURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
    }

    private func nodePath() -> String? {
        [
            config["nodePath"] as? String, Bundle.main.resourceURL?.appendingPathComponent("runtime/bin/node").path,
            "/opt/homebrew/opt/node@24/bin/node", "/usr/local/opt/node@24/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node"
        ].compactMap { $0 }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    @objc private func showSettings() {
        if window == nil {
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 360),
                                 styleMask: [.titled, .closable], backing: .buffered, defer: false)
            panel.title = "工作台 Agent 连接"
            panel.isReleasedWhenClosed = false
            let stack = NSStackView()
            stack.orientation = .vertical
            stack.alignment = .leading
            stack.spacing = 12
            stack.translatesAutoresizingMaskIntoConstraints = false
            panel.contentView!.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 24),
                stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -24),
                stack.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 24)
            ])
            let title = NSTextField(labelWithString: "将这台 Mac 接入你的 AI Teams")
            title.font = .systemFont(ofSize: 19, weight: .semibold)
            stack.addArrangedSubview(title)
            for (label, field) in [("工作台地址", serverField), ("设备名称", nameField), ("一次性配对码", codeField)] {
                let row = NSStackView()
                row.orientation = .vertical
                row.alignment = .leading
                row.spacing = 4
                row.addArrangedSubview(NSTextField(labelWithString: label))
                row.addArrangedSubview(field)
                stack.addArrangedSubview(row)
                row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
                field.widthAnchor.constraint(equalTo: row.widthAnchor).isActive = true
            }
            codeField.placeholderString = "在 AI Teams → 设备中生成"
            let actions = NSStackView()
            actions.spacing = 12
            for (label, selector) in [("配对并连接", #selector(pair)), ("打开设备页面", #selector(openDevices))] {
                let button = NSButton(title: label, target: self, action: selector)
                button.bezelStyle = .rounded
                actions.addArrangedSubview(button)
            }
            stack.addArrangedSubview(actions)
            infoLabel.textColor = .secondaryLabelColor
            stack.addArrangedSubview(infoLabel)
            window = panel
        }
        serverField.stringValue = config["serverUrl"] as? String ?? "https://vivid-dream.online"
        nameField.stringValue = Host.current().localizedName ?? "我的 Mac"
        window!.center()
        window!.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func pair() {
        if pairing { return }
        guard let node = nodePath() else { infoLabel.stringValue = "需要安装 Node.js 24 和 Codex CLI。"; return }
        let server = serverField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = codeField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: server), url.scheme == "https" ||
                (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "")), !code.isEmpty else {
            infoLabel.stringValue = "请填写有效工作台地址和配对码。"
            return
        }
        pairing = true
        infoLabel.stringValue = "正在配对…"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [connectorPath, "--pair", "--server", server, "--code", code, "--name", nameField.stringValue,
                             "--config", configURL.path, "--keychain-helper", helperPath]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        process.terminationHandler = { [weak self] task in
            _ = output.fileHandleForReading.readDataToEndOfFile()
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.pairing = false
                if task.terminationStatus == 0 {
                    self.codeField.stringValue = ""
                    self.loadConfig()
                    self.window?.close()
                    self.restartBridge()
                } else { self.infoLabel.stringValue = "配对未完成，请检查地址、配对码、钥匙串和网络。" }
            }
        }
        do {
            try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try process.run()
        } catch { pairing = false; infoLabel.stringValue = "无法启动本机连接程序。" }
    }

    @objc private func addProject() {
        let picker = NSOpenPanel()
        picker.title = "选择允许 Agent 工作的 Git 项目"
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        if picker.runModal() == .OK, let url = picker.url?.resolvingSymlinksInPath() {
            var projects = config["projects"] as? [[String: Any]] ?? []
            if !projects.contains(where: { $0["path"] as? String == url.path }) {
                projects.append(["id": UUID().uuidString.lowercased(), "name": url.lastPathComponent, "path": url.path])
            }
            config["projects"] = projects
            do { try saveConfig(); if config["deviceId"] as? String != nil { restartBridge() } }
            catch { showError("无法保存项目配置。") }
        }
    }

    @objc private func startBridge() {
        if bridge?.isRunning == true { return }
        loadConfig()
        guard config["deviceId"] as? String != nil else { showSettings(); return }
        guard let node = nodePath() else { showError("没有找到 Node.js 24。"); return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [connectorPath, "--config", configURL.path, "--keychain-helper", helperPath]
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
        process.environment = environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        buffer = ""
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty { DispatchQueue.main.async { self?.consume(data) } }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        process.terminationHandler = { [weak self] _ in
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self = self, self.bridge === process else { return }
                self.bridge = nil
                self.setStatus("同步已停止", running: false)
                if self.restartAfterExit {
                    self.restartAfterExit = false
                    self.startBridge()
                }
            }
        }
        do { try process.run(); bridge = process; setStatus("正在连接…", running: false) }
        catch { showError("无法启动同步，请检查本机 Codex 和 Node.js。") }
    }

    private func consume(_ data: Data) {
        buffer += String(decoding: data, as: UTF8.self)
        while let end = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<end])
            buffer.removeSubrange(...end)
            guard let bytes = line.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { continue }
            let state = event["state"] as? String ?? event["type"] as? String ?? ""
            let active = ["running", "executing", "starting"].contains(state)
            setStatus(event["message"] as? String ?? (active ? "任务执行中" : "已连接"), running: active)
        }
        if buffer.count > 16384 { buffer = "" }
    }

    private func setStatus(_ text: String, running: Bool) {
        statusLabel.title = String(text.prefix(100))
        item.button?.title = running ? "● Agents" : "◉ Agents"
        if running && activity == nil { activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: "执行工作台 Agent 任务") }
        else if !running, let token = activity { ProcessInfo.processInfo.endActivity(token); activity = nil }
    }

    private func restartBridge() {
        if let process = bridge, process.isRunning {
            restartAfterExit = true
            process.terminate()
            setStatus("正在重新连接…", running: false)
        } else {
            restartAfterExit = false
            startBridge()
        }
    }

    @objc private func stopBridge() {
        restartAfterExit = false
        if let process = bridge, process.isRunning {
            process.terminate()
            if item != nil { setStatus("正在停止同步…", running: false) }
        } else if item != nil {
            setStatus("同步已停止", running: false)
        }
    }
    private func siteURL(_ route: String) -> URL? { URL(string: (config["serverUrl"] as? String ?? "https://vivid-dream.online") + "/#" + route) }
    @objc private func openTeams() { if let url = siteURL("ai-teams") { NSWorkspace.shared.open(url) } }
    @objc private func openTasks() { if let url = siteURL("development/tasks") { NSWorkspace.shared.open(url) } }
    @objc private func openDevices() { if let url = siteURL("ai-teams/devices") { NSWorkspace.shared.open(url) } }
    @objc private func quitApp() { stopBridge(); NSApp.terminate(nil) }
    private func showError(_ message: String) { let alert = NSAlert(); alert.messageText = message; alert.runModal() }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first, url.scheme == "workbench-agent",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        if url.host == "run" {
            guard let runID = components.queryItems?.first(where: { $0.name == "runId" })?.value,
                  UUID(uuidString: runID) != nil else { return }
            let state = config["stateDir"] as? String ?? configDirectory.appendingPathComponent("state").path
            let stateURL = URL(fileURLWithPath: state).resolvingSymlinksInPath()
            let journalURL = stateURL.appendingPathComponent("journal.json")
            guard let data = try? Data(contentsOf: journalURL),
                  let journal = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let runs = journal["runs"] as? [String: [String: Any]],
                  let path = runs[runID]?["cwd"] as? String else {
                showError("这台 Mac 上没有该任务的工作目录。")
                return
            }
            let directory = URL(fileURLWithPath: path).resolvingSymlinksInPath()
            let allowed = stateURL.appendingPathComponent("worktrees").path + "/"
            guard directory.path.hasPrefix(allowed), FileManager.default.fileExists(atPath: directory.path) else {
                showError("任务工作目录尚不可用。")
                return
            }
            NSWorkspace.shared.open(directory)
            return
        }
        showSettings()
        if let server = components.queryItems?.first(where: { $0.name == "server" })?.value { serverField.stringValue = server }
        if let code = components.queryItems?.first(where: { $0.name == "code" })?.value { codeField.stringValue = code }
    }
    func applicationWillTerminate(_ notification: Notification) { stopBridge() }
}

let application = NSApplication.shared
let delegate = BridgeApp()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
