import SwiftUI
import UniformTypeIdentifiers
#if canImport(VisionKit)
import VisionKit
#endif

struct ConnectView: View {
    @EnvironmentObject var store: PackStore
    @State private var link = ""
    @State private var scanning = false
    @State private var importing = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let msg = store.message {
                    Text(msg).font(.subheadline).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background((store.isError ? Theme.danger : Theme.ok).opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(store.isError ? Theme.danger : Theme.ok)
                }
                Card(title: "Status") {
                    if let p = store.pack {
                        Text(p.event?.name ?? p.competition.name).font(.headline)
                        Text("Team \(p.myTeam.isEmpty ? "–" : p.myTeam) · \(p.matches.count) matches · \(p.teams.count) teams").font(.subheadline).foregroundStyle(Theme.text2)
                        if let d = store.lastSync { Text("Last update \(d.formatted(date: .abbreviated, time: .shortened))").font(.footnote).foregroundStyle(Theme.text3) }
                    } else { Text("No data yet").foregroundStyle(Theme.text2) }
                    if store.hasConnection {
                        Button { Task { await store.sync() } } label: { Label(store.syncing ? "Updating…" : "Update now", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).disabled(store.syncing)
                    }
                }
                Card(title: "Connect to Packout") {
                    Text("On your computer open Packout → Phone → Start sharing, then scan the code or paste the link. Phone and computer need to be on the same Wi-Fi — or plug the phone in and turn on Personal Hotspot.")
                        .font(.footnote).foregroundStyle(Theme.text2)
                    #if canImport(VisionKit)
                    if DataScannerViewController.isSupported {
                        Button { scanning = true } label: { Label("Scan QR code", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent)
                    }
                    #endif
                    TextField("http://192.168.1.20:8731/?k=…", text: $link).textFieldStyle(.roundedBorder).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    HStack {
                        Button("Paste") { link = UIPasteboard.general.string ?? link }.buttonStyle(.bordered)
                        Button("Connect") { connect() }.buttonStyle(.bordered).disabled(link.isEmpty)
                        if store.hasConnection { Button("Forget", role: .destructive) { store.forget() }.buttonStyle(.bordered) }
                    }
                }
                Card(title: "Or use a file") {
                    Text("In Packout choose Phone → Save coach file, send it to this phone (AirDrop, Files, email) and open it here. Works with no connection at all.").font(.footnote).foregroundStyle(Theme.text2)
                    Button { importing = true } label: { Label("Import coach file", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
                    Button { store.loadDemo() } label: { Label("Load demo data", systemImage: "sparkles").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
                }
            }.padding(16)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, UTType(filenameExtension: "packoutcoach") ?? .data]) { result in
            if case .success(let url) = result { store.importFile(url) }
        }
        #if canImport(VisionKit)
        .sheet(isPresented: $scanning) { QRScanner { code in scanning = false; link = code; connect() }.ignoresSafeArea() }
        #endif
    }

    private func connect() {
        if store.connect(link: link) { link = ""; Task { await store.sync() } }
    }
}

#if canImport(VisionKit)
struct QRScanner: UIViewControllerRepresentable {
    var onCode: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onCode) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        var done = false
        init(_ f: @escaping (String) -> Void) { onCode = f }
        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for case .barcode(let b) in items { if let s = b.payloadStringValue { done = true; onCode(s); return } }
        }
    }
}
#endif
