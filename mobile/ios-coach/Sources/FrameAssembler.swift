import Foundation
import Compression

/// Reassembles the looping QR frames Packout shows on screen (no network needed).
/// Frame: PK1.<session>.<index>.<total>.<crc32 hex>.<base64 slice>
final class FrameAssembler {
    enum Result: Equatable {
        case progress(received: Int, total: Int)
        case complete(Data)
        case ignored
        case failed(String)
    }

    private(set) var session: String?
    private(set) var total = 0
    private var crc = ""
    private var chunks: [Int: String] = [:]
    private var pendingSession: String?
    private var pendingCount = 0

    var received: Int { chunks.count }
    var receivedIndexes: Set<Int> { Set(chunks.keys) }

    func reset() { pendingSession = nil; pendingCount = 0; session = nil; total = 0; crc = ""; chunks = [:] }

    func add(_ payload: String) -> Result {
        guard payload.hasPrefix("PK1.") else { return .ignored }
        let parts = payload.split(separator: ".", maxSplits: 5, omittingEmptySubsequences: false)
        guard parts.count == 6, let index = Int(parts[2]), let n = Int(parts[3]), n > 0, index >= 0, index < n else { return .ignored }
        let sid = String(parts[1])
        if sid != session {
            // A single stray misread shouldn't wipe progress: switch sessions only when the new id repeats.
            if session != nil && !chunks.isEmpty {
                if sid != pendingSession { pendingSession = sid; pendingCount = 1; return .progress(received: chunks.count, total: total) }
                pendingCount += 1
                if pendingCount < 2 { return .progress(received: chunks.count, total: total) }
            }
            reset(); session = sid; total = n; crc = String(parts[4])
        }
        pendingSession = nil; pendingCount = 0
        guard n == total else { return .ignored }
        chunks[index] = String(parts[5])
        guard chunks.count == total else { return .progress(received: chunks.count, total: total) }
        return finish()
    }

    private func finish() -> Result {
        let b64 = (0..<total).compactMap { chunks[$0] }.joined()
        guard let compressed = Data(base64Encoded: b64) else { reset(); return .failed("Corrupt data — scan again.") }
        guard String(format: "%08x", FrameAssembler.crc32(compressed)) == crc else { reset(); return .failed("A frame was misread — scan again.") }
        guard let raw = FrameAssembler.inflate(compressed) else { reset(); return .failed("Could not unpack the data.") }
        return .complete(raw)
    }

    static func crc32(_ data: Data) -> UInt32 {
        var table = [UInt32](repeating: 0, count: 256)
        for n in 0..<256 {
            var c = UInt32(n)
            for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
            table[n] = c
        }
        var c: UInt32 = 0xFFFF_FFFF
        for b in data { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }

    /// Apple's COMPRESSION_ZLIB is raw DEFLATE, the same format as CompressionStream('deflate-raw').
    static func inflate(_ data: Data) -> Data? {
        var capacity = max(data.count * 12, 64 * 1024)
        for _ in 0..<4 {
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { buffer.deallocate() }
            let size = data.withUnsafeBytes { src -> Int in
                guard let base = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                return compression_decode_buffer(buffer, capacity, base, data.count, nil, COMPRESSION_ZLIB)
            }
            if size > 0 && size < capacity { return Data(bytes: buffer, count: size) }
            capacity *= 4
        }
        return nil
    }
}
