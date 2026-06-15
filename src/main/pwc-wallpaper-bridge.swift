import AppKit
import CoreFoundation
import Foundation

struct BridgeOutput: Codable {
    var ok: Bool
    var mode: String
    var frameworksLoaded: [String]
    var privateFrameworksAvailable: Bool
    var xpcServices: [String]
    var discoveredProtocols: [String]
    var discoveredSelectors: [String]
    var discoveredClasses: [String]
    var mechanism: String?
    var requestAccepted: Bool
    var distributedNotificationsPosted: [String]
    var darwinNotificationsPosted: [String]
    var error: String?
}

private let frameworkPaths = [
    "/System/Library/PrivateFrameworks/Wallpaper.framework",
    "/System/Library/PrivateFrameworks/WallpaperFoundation.framework",
    "/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework"
]

private func loadFrameworks() -> [String] {
    frameworkPaths.filter { FileManager.default.fileExists(atPath: $0) }
}

private func symbols(in binary: String) -> [String] {
    guard FileManager.default.isExecutableFile(atPath: "/usr/bin/nm"),
          FileManager.default.fileExists(atPath: binary) else { return [] }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/nm")
    task.arguments = ["-gj", binary]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = FileHandle.nullDevice
    do {
        try task.run()
    } catch {
        return []
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    return String(decoding: data, as: UTF8.self)
        .split(whereSeparator: { $0.isNewline })
        .map(String.init)
}

private struct RuntimeDiscovery {
    var xpcServices: [String]
    var protocols: [String]
    var selectors: [String]
    var classes: [String]
}

private func discoverWallpaperRuntime() -> RuntimeDiscovery {
    let agentPath = "/System/Library/CoreServices/WallpaperAgent.app/Contents/MacOS/WallpaperAgent"
    let agentSymbols = symbols(in: agentPath)
    let wantedSelectors = [
        "updateDesktopWallpaperUserSettings(_:sender:)",
        "diagnosticState(sender:)",
        "snapshotAllSpaces(sender:)",
        "setDisplaySpacesInfo(info:sender:)",
        "registerSettingsObserver(sender:)"
    ]
    let selectors = wantedSelectors.filter { selector in
        if selector == "updateDesktopWallpaperUserSettings(_:sender:)" {
            return agentSymbols.contains { $0.contains("updateDesktop") && $0.contains("UserSettings") }
        }
        let compact = selector
            .replacingOccurrences(of: "(_:sender:)", with: "")
            .replacingOccurrences(of: "(sender:)", with: "")
            .replacingOccurrences(of: "(info:sender:)", with: "")
        return agentSymbols.contains { $0.contains(compact) }
    }
    let classes = [
        "WallpaperAgent.Agent",
        "Wallpaper.AgentListener",
        "Wallpaper.ClientProxy",
        "Wallpaper.DefaultListenerEnvironment"
    ].filter { className in
        agentSymbols.contains { $0.contains(className.replacingOccurrences(of: ".", with: "")) }
    }
    let protocols = selectors.isEmpty ? [] : ["Wallpaper.AgentXPCProtocol"]
    let services = protocols.isEmpty ? [] : ["com.apple.wallpaper"]
    return RuntimeDiscovery(
        xpcServices: services,
        protocols: protocols,
        selectors: selectors,
        classes: classes
    )
}

private func encode(_ output: BridgeOutput) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(output) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

let arguments = CommandLine.arguments
let mode = arguments.count > 1 ? arguments[1] : "probe"
let storePath = arguments.count > 2 ? arguments[2] : nil
let loaded = loadFrameworks()
private let discovery = discoverWallpaperRuntime()
let frameworkAvailable = loaded.contains { $0.hasSuffix("/Wallpaper.framework") }

switch mode {
case "probe":
    encode(BridgeOutput(
        ok: frameworkAvailable && discovery.protocols.contains("Wallpaper.AgentXPCProtocol"),
        mode: mode,
        frameworksLoaded: loaded,
        privateFrameworksAvailable: frameworkAvailable,
        xpcServices: discovery.xpcServices,
        discoveredProtocols: discovery.protocols,
        discoveredSelectors: discovery.selectors,
        discoveredClasses: discovery.classes,
        mechanism: discovery.protocols.contains("Wallpaper.AgentXPCProtocol") ? "Wallpaper.AgentXPCProtocol" : nil,
        requestAccepted: false,
        distributedNotificationsPosted: [],
        darwinNotificationsPosted: [],
        error: frameworkAvailable ? nil : "The private Wallpaper framework was not loadable."
    ))
    exit((frameworkAvailable && discovery.protocols.contains("Wallpaper.AgentXPCProtocol")) ? 0 : 2)
case "refresh":
    guard let storePath, FileManager.default.isReadableFile(atPath: storePath) else {
        encode(BridgeOutput(ok: false, mode: mode, frameworksLoaded: loaded, privateFrameworksAvailable: frameworkAvailable, xpcServices: discovery.xpcServices, discoveredProtocols: discovery.protocols, discoveredSelectors: discovery.selectors, discoveredClasses: discovery.classes, mechanism: nil, requestAccepted: false, distributedNotificationsPosted: [], darwinNotificationsPosted: [], error: "The wallpaper Store path was missing or unreadable."))
        exit(3)
    }
    guard frameworkAvailable else {
        encode(BridgeOutput(ok: false, mode: mode, frameworksLoaded: loaded, privateFrameworksAvailable: frameworkAvailable, xpcServices: discovery.xpcServices, discoveredProtocols: discovery.protocols, discoveredSelectors: discovery.selectors, discoveredClasses: discovery.classes, mechanism: nil, requestAccepted: false, distributedNotificationsPosted: [], darwinNotificationsPosted: [], error: "The private Wallpaper framework was not loadable."))
        exit(4)
    }
    guard discovery.protocols.contains("Wallpaper.AgentXPCProtocol") else {
        encode(BridgeOutput(ok: false, mode: mode, frameworksLoaded: loaded, privateFrameworksAvailable: frameworkAvailable, xpcServices: discovery.xpcServices, discoveredProtocols: discovery.protocols, discoveredSelectors: discovery.selectors, discoveredClasses: discovery.classes, mechanism: nil, requestAccepted: false, distributedNotificationsPosted: [], darwinNotificationsPosted: [], error: "No WallpaperAgent XPC protocol was discovered on this macOS build."))
        exit(5)
    }
    encode(BridgeOutput(
        ok: false,
        mode: mode,
        frameworksLoaded: loaded,
        privateFrameworksAvailable: frameworkAvailable,
        xpcServices: discovery.xpcServices,
        discoveredProtocols: discovery.protocols,
        discoveredSelectors: discovery.selectors,
        discoveredClasses: discovery.classes,
        mechanism: "Wallpaper.AgentXPCProtocol",
        requestAccepted: false,
        distributedNotificationsPosted: [],
        darwinNotificationsPosted: [],
        error: "WallpaperAgent exposes Wallpaper.AgentXPCProtocol, but this helper has not established a callable client connection for updateDesktopWallpaperUserSettings(_:sender:). No guessed notifications were posted."
    ))
    exit(6)
default:
    encode(BridgeOutput(ok: false, mode: mode, frameworksLoaded: loaded, privateFrameworksAvailable: frameworkAvailable, xpcServices: discovery.xpcServices, discoveredProtocols: discovery.protocols, discoveredSelectors: discovery.selectors, discoveredClasses: discovery.classes, mechanism: nil, requestAccepted: false, distributedNotificationsPosted: [], darwinNotificationsPosted: [], error: "Unknown helper mode."))
    exit(64)
}
