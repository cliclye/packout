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

    private var canScan: Bool {
        #if canImport(VisionKit)
        return DataScannerViewController.isSupported
        #else
        return false
        #endif
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let msg = store.message {
                    Text(msg).font(.subheadline).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background((store.isError ? Theme.danger : Theme.ok).opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(store.isError ? Theme.danger : Theme.ok)
                }
                Card(title: "Get data from your computer — no Wi-Fi needed") {
                    VStack(alignment: .leading, spacing: 8) {
                        step(1, "In Packout on your computer open Phone → Show QR code.")
                        step(2, "Tap the button below and point the camera at the moving code.")
                        step(3, "Hold steady until every box turns green (about 10 seconds).")
                    }
                    Text("Nothing is sent over a network.").font(.caption).foregroundStyle(Theme.text3)
                    if canScan {
                        Button { scanning = true } label: { Label("Scan from computer screen", systemImage: "qrcode.viewfinder").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 8) }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                    } else {
                        Text("Camera scanning isn’t available on this device.").font(.footnote).foregroundStyle(Theme.warn)
                    }
                }
                Card(title: "Status") {
                    if let p = store.pack {
                        Text(p.event?.name ?? p.competition.name).font(.headline)
                        Text("Team \(p.myTeam.isEmpty ? "–" : p.myTeam) · \(p.matches.count) matches · \(p.teams.count) teams").font(.subheadline).foregroundStyle(Theme.text2)
                        if let d = store.lastSync { Text("Last update \(d.formatted(date: .abbreviated, time: .shortened))").font(.footnote).foregroundStyle(Theme.text3) }
                    } else { Text("No data yet").foregroundStyle(Theme.text2) }
                }
                Card(title: "Other ways") {
                    Button { importing = true } label: { Label("Import a coach file (AirDrop / Files)", systemImage: "square.and.arrow.down").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
                    DisclosureGroup("Connect over Wi-Fi (practice / home)") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Only where Wi-Fi is allowed. In Packout press Start sharing, then paste the link here.").font(.footnote).foregroundStyle(Theme.text2)
                            TextField("http://192.168.1.20:8731/?k=…", text: $link).textFieldStyle(.roundedBorder).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                            HStack {
                                Button("Paste") { link = UIPasteboard.general.string ?? link }.buttonStyle(.bordered)
                                Button("Connect") { connect() }.buttonStyle(.bordered).disabled(link.isEmpty)
                                if store.hasConnection {
                                    Button("Update") { Task { await store.sync() } }.buttonStyle(.bordered).disabled(store.syncing)
                                    Button("Forget", role: .destructive) { store.forget() }.buttonStyle(.bordered)
                                }
                            }
                        }.padding(.top, 6)
                    }.tint(Theme.accent)
                    Button { store.loadDemo() } label: { Label("Load demo data", systemImage: "sparkles").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
                }
            }.padding(16)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, UTType(filenameExtension: "packoutcoach") ?? .data]) { result in
            if case .success(let url) = result { store.importFile(url) }
        }
        #if canImport(VisionKit)
        .fullScreenCover(isPresented: $scanning) {
            FrameScannerScreen(
                onPack: { data in scanning = false; store.importPack(data, source: "the computer screen") },
                onLink: { code in scanning = false; link = code; connect() },
                onCancel: { scanning = false })
        }
        #endif
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(.caption.weight(.heavy)).frame(width: 22, height: 22).background(Theme.accent.opacity(0.2), in: Circle()).foregroundStyle(Theme.accent)
            Text(text).font(.subheadline).foregroundStyle(Theme.text2).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func connect() {
        if store.connect(link: link) { link = ""; Task { await store.sync() } }
    }
}

#if canImport(VisionKit)
/// Camera screen that collects every frame of the looping QR sequence (or a single link QR).
@MainActor
final class ScanModel: ObservableObject {
    @Published var received = 0
    @Published var total = 0
    @Published var indexes: Set<Int> = []
    @Published var error: String?
    private let assembler = FrameAssembler()
    var onPack: (Data) -> Void = { _ in }
    var onLink: (String) -> Void = { _ in }
    private var finished = false

    func handle(_ payload: String) {
        guard !finished else { return }
        if payload.lowercased().hasPrefix("http") { finished = true; onLink(payload); return }
        switch assembler.add(payload) {
        case .progress(let r, let t): received = r; total = t; indexes = assembler.receivedIndexes; error = nil
        case .complete(let data): finished = true; UINotificationFeedbackGenerator().notificationOccurred(.success); onPack(data)
        case .failed(let m): error = m; received = 0; total = 0; indexes = []
        case .ignored: break
        }
    }
}

struct FrameScannerScreen: View {
    var onPack: (Data) -> Void
    var onLink: (String) -> Void
    var onCancel: () -> Void
    @StateObject private var model = ScanModel()

    var body: some View {
        ZStack(alignment: .bottom) {
            ScannerRepresentable(model: model).ignoresSafeArea()
            VStack(spacing: 10) {
                if model.total > 0 {
                    Text("Collecting frames — \(model.received) of \(model.total)").font(.headline)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 10, maximum: 28), spacing: 5), count: min(model.total, 14)), spacing: 5) {
                        ForEach(0..<model.total, id: \.self) { i in
                            RoundedRectangle(cornerRadius: 4).fill(model.indexes.contains(i) ? Theme.ok : Theme.border).frame(height: 14)
                        }
                    }
                    Text("Keep the code in view until every box is green.").font(.footnote).foregroundStyle(Theme.text2)
                } else {
                    Text("Point at the moving QR code in Packout").font(.headline)
                    Text("Hold about 20–30 cm from the screen. It loops, so you can start anywhere.").font(.footnote).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
                }
                if let e = model.error { Text(e).font(.footnote).foregroundStyle(Theme.danger) }
                Button("Cancel", role: .cancel) { onCancel() }.buttonStyle(.bordered)
            }
            .padding(16).frame(maxWidth: .infinity)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22)).padding(12)
        }
        .onAppear { model.onPack = onPack; model.onLink = onLink }
    }
}

struct ScannerRepresentable: UIViewControllerRepresentable {
    let model: ScanModel
    func makeCoordinator() -> Coordinator { Coordinator(model) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .accurate, recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let model: ScanModel
        init(_ m: ScanModel) { model = m }
        func dataScanner(_ s: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) { forward(items) }
        func dataScanner(_ s: DataScannerViewController, didUpdate items: [RecognizedItem], allItems: [RecognizedItem]) { forward(items) }
        private func forward(_ items: [RecognizedItem]) {
            for case .barcode(let b) in items { if let p = b.payloadStringValue { Task { @MainActor in model.handle(p) } } }
        }
    }
}
#endif
