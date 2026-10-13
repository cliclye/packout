import Foundation
import SwiftUI

/// Holds the current coach pack, keeps a copy on disk (so it works with no signal) and can
/// refresh it from Packout over the local network.
@MainActor
final class PackStore: ObservableObject {
    @Published private(set) var pack: CoachPack?
    @Published var syncing = false
    @Published var message: String?
    @Published var isError = false
    @AppStorage("syncBase") var syncBase = ""
    @AppStorage("syncKey") var syncKey = ""
    @Published var lastSync: Date?

    private let fileURL: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("coach.json")
    }()

    init() {
        if let data = try? Data(contentsOf: fileURL), let p = try? JSONDecoder().decode(CoachPack.self, from: data) {
            pack = p
            lastSync = (try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        }
    }

    var hasConnection: Bool { !syncBase.isEmpty && !syncKey.isEmpty }

    // MARK: importing

    func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            try accept(Data(contentsOf: url))
            note("Imported \(url.lastPathComponent)")
        } catch {
            note(error.localizedDescription, error: true)
        }
    }

    /// Raw JSON delivered by the QR-frame scanner.
    func importPack(_ data: Data, source: String) {
        do { try accept(data); note("Received from \(source)") } catch { note(error.localizedDescription, error: true) }
    }

    func loadDemo() {
        guard let url = Bundle.main.url(forResource: "sample-pack", withExtension: "json") else { return }
        do { try accept(Data(contentsOf: url)); note("Loaded demo data") } catch { note(error.localizedDescription, error: true) }
    }

    private func accept(_ data: Data) throws {
        let p = try JSONDecoder().decode(CoachPack.self, from: data)
        guard p.format == "packout-coach" else { throw StoreError.notCoachFile }
        pack = p
        try data.write(to: fileURL, options: .atomic)
        lastSync = Date()
    }

    // MARK: network sync

    /// Accepts the link shown in Packout, e.g. http://192.168.1.20:8731/?k=abc123
    func connect(link: String) -> Bool {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let comps = URLComponents(string: trimmed.contains("://") ? trimmed : "http://" + trimmed),
              let host = comps.host,
              let key = comps.queryItems?.first(where: { $0.name == "k" })?.value, !key.isEmpty else {
            note("That doesn’t look like the link from Packout’s Phone page.", error: true)
            return false
        }
        syncBase = "\(comps.scheme ?? "http")://\(host):\(comps.port ?? 8731)"
        syncKey = key
        return true
    }

    func forget() { syncBase = ""; syncKey = "" }

    func sync(silent: Bool = false) async {
        guard hasConnection, !syncing else { return }
        guard var comps = URLComponents(string: syncBase + "/data.json") else { return }
        comps.queryItems = [URLQueryItem(name: "k", value: syncKey)]
        guard let url = comps.url else { return }
        syncing = true
        defer { syncing = false }
        do {
            var req = URLRequest(url: url, timeoutInterval: 8)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw StoreError.badResponse }
            switch http.statusCode {
            case 200: try accept(data); if !silent { note("Updated") } else { isError = false; message = nil }
            case 403: throw StoreError.wrongKey
            case 404: throw StoreError.nothingPublished
            default: throw StoreError.badResponse
            }
        } catch {
            // Offline is normal at the field: keep showing the last copy, only complain when asked.
            if !silent { note(friendly(error), error: true) } else if pack == nil { note(friendly(error), error: true) }
        }
    }

    private func friendly(_ e: Error) -> String {
        if let s = e as? StoreError { return s.localizedDescription }
        let ns = e as NSError
        if ns.domain == NSURLErrorDomain { return "Can’t reach Packout — showing your saved data." }
        return e.localizedDescription
    }

    private func note(_ text: String, error: Bool = false) { message = text; isError = error }

    enum StoreError: LocalizedError {
        case notCoachFile, wrongKey, nothingPublished, badResponse
        var errorDescription: String? {
            switch self {
            case .notCoachFile: return "That file isn’t a Packout coach file."
            case .wrongKey: return "Wrong key — scan the QR code in Packout again."
            case .nothingPublished: return "Packout hasn’t published data yet. Press Start sharing on its Phone page."
            case .badResponse: return "Unexpected reply from Packout."
            }
        }
    }
}
