import SwiftUI
import UniformTypeIdentifiers
import AVFoundation
import Vision

struct ConnectView: View {
    @EnvironmentObject var store: PackStore
    @State private var link = ""
    @State private var scanning = false
    @State private var importing = false

    private var canScan: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
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
        .fullScreenCover(isPresented: $scanning) {
            FrameScannerScreen(
                onPack: { data in scanning = false; store.importPack(data, source: "the computer screen") },
                onLink: { code in scanning = false; link = code; connect() },
                onCancel: { scanning = false })
        }
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

/// Camera screen that collects every frame of the looping QR sequence (or a single link QR).
@MainActor
final class ScanModel: ObservableObject {
    @Published var received = 0
    @Published var total = 0
    @Published var indexes: Set<Int> = []
    @Published var error: String?
    @Published var zoom: CGFloat = 1
    @Published var torch = false
    @Published var lastSeen = Date()
    private let assembler = FrameAssembler()
    var onPack: (Data) -> Void = { _ in }
    var onLink: (String) -> Void = { _ in }
    private var finished = false

    func handle(_ payload: String) {
        guard !finished else { return }
        lastSeen = Date()
        if payload.lowercased().hasPrefix("http") { finished = true; onLink(payload); return }
        switch assembler.add(payload) {
        case .progress(let r, let t): if r > received { UIImpactFeedbackGenerator(style: .light).impactOccurred() }; received = r; total = t; indexes = assembler.receivedIndexes; error = nil
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
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    if Date().timeIntervalSince(model.lastSeen) > 3 {
                        Text("No code in view. Fill the frame with the QR, hold 20–30 cm away, turn the computer screen brightness up, and tap the code to focus.")
                            .font(.footnote).foregroundStyle(Theme.warn).multilineTextAlignment(.center)
                    }
                }
                if let e = model.error { Text(e).font(.footnote).foregroundStyle(Theme.danger) }
                HStack(spacing: 8) {
                    ForEach([1.0, 1.5, 2.0, 3.0], id: \.self) { z in
                        Button(z == 1 ? "1×" : String(format: "%.1f×", z)) { model.zoom = CGFloat(z) }
                            .buttonStyle(.bordered).tint(model.zoom == CGFloat(z) ? Theme.accent : Theme.text3)
                    }
                    Button { model.torch.toggle() } label: { Image(systemName: model.torch ? "flashlight.on.fill" : "flashlight.off.fill") }.buttonStyle(.bordered)
                    Button("Cancel", role: .cancel) { onCancel() }.buttonStyle(.bordered)
                }
            }
            .padding(16).frame(maxWidth: .infinity)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22)).padding(12)
        }
        .onAppear { model.onPack = onPack; model.onLink = onLink }
    }
}

/// Reads every camera frame with Vision. DataScanner only reports an item when it appears or moves,
/// which misses a code that changes in place; this looks at each frame, so no QR frame is skipped.
struct ScannerRepresentable: UIViewControllerRepresentable {
    let model: ScanModel
    func makeUIViewController(context: Context) -> CameraController {
        let vc = CameraController()
        vc.onPayload = { [weak model] p in model?.handle(p) }
        return vc
    }
    func updateUIViewController(_ vc: CameraController, context: Context) {
        vc.setZoom(model.zoom)
        vc.setTorch(model.torch)
    }
}

final class CameraController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onPayload: (String) -> Void = { _ in }
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "packout.scan", qos: .userInitiated)
    private var device: AVCaptureDevice?
    private var preview: AVCaptureVideoPreviewLayer?
    private var lastPayload = ""
    private var lastPayloadAt = Date.distantPast

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async { if ok { self.configure() } }
        }
    }

    private func configure() {
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: dev) else { return }
        device = dev
        session.beginConfiguration()
        session.sessionPreset = session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
        if session.canAddInput(input) { session.addInput(input) }
        let out = AVCaptureVideoDataOutput()
        out.alwaysDiscardsLateVideoFrames = true
        out.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(out) { session.addOutput(out) }
        session.commitConfiguration()

        if (try? dev.lockForConfiguration()) != nil {
            if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
            if dev.isAutoFocusRangeRestrictionSupported { dev.autoFocusRangeRestriction = .near }   // screens are close
            if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
            dev.unlockForConfiguration()
        }
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.addSublayer(layer)
        preview = layer
        let tap = UITapGestureRecognizer(target: self, action: #selector(focusTap(_:)))
        view.addGestureRecognizer(tap)
        DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
    }

    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); session.stopRunning(); setTorch(false) }

    @objc private func focusTap(_ g: UITapGestureRecognizer) {
        guard let dev = device, let layer = preview else { return }
        let p = layer.captureDevicePointConverted(fromLayerPoint: g.location(in: view))
        guard (try? dev.lockForConfiguration()) != nil else { return }
        if dev.isFocusPointOfInterestSupported { dev.focusPointOfInterest = p; dev.focusMode = .continuousAutoFocus }
        if dev.isExposurePointOfInterestSupported { dev.exposurePointOfInterest = p; dev.exposureMode = .continuousAutoExposure }
        dev.unlockForConfiguration()
    }

    func setZoom(_ z: CGFloat) {
        guard let dev = device, abs(dev.videoZoomFactor - z) > 0.01, (try? dev.lockForConfiguration()) != nil else { return }
        dev.videoZoomFactor = max(1, min(z, dev.activeFormat.videoMaxZoomFactor))
        dev.unlockForConfiguration()
    }

    func setTorch(_ on: Bool) {
        guard let dev = device, dev.hasTorch, (dev.torchMode == .on) != on, (try? dev.lockForConfiguration()) != nil else { return }
        dev.torchMode = on ? .on : .off
        dev.unlockForConfiguration()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        try? VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:]).perform([request])
        for case let code as VNBarcodeObservation in request.results ?? [] {
            guard let payload = code.payloadStringValue else { continue }
            // Same frame seen on consecutive camera frames: pass it on at most every 150 ms.
            if payload == lastPayload && Date().timeIntervalSince(lastPayloadAt) < 0.15 { continue }
            lastPayload = payload; lastPayloadAt = Date()
            DispatchQueue.main.async { self.onPayload(payload) }
        }
    }
}

