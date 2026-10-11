import SwiftUI

enum Theme {
    static let bg = Color(red: 0.047, green: 0.055, blue: 0.075)
    static let surface = Color(red: 0.078, green: 0.09, blue: 0.118)
    static let surface2 = Color(red: 0.098, green: 0.114, blue: 0.149)
    static let border = Color(red: 0.145, green: 0.165, blue: 0.216)
    static let accent = Color(red: 0.427, green: 0.514, blue: 1.0)
    static let red = Color(red: 1.0, green: 0.353, blue: 0.373)
    static let blue = Color(red: 0.302, green: 0.553, blue: 1.0)
    static let ok = Color(red: 0.235, green: 0.812, blue: 0.49)
    static let warn = Color(red: 0.953, green: 0.635, blue: 0.227)
    static let danger = Color(red: 1.0, green: 0.4, blue: 0.455)
    static let text2 = Color(red: 0.667, green: 0.698, blue: 0.765)
    static let text3 = Color(red: 0.49, green: 0.525, blue: 0.604)
}

struct Card<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title.uppercased()).font(.caption.weight(.bold)).tracking(0.6).foregroundStyle(Theme.text3) }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border))
    }
}

struct TeamChip: View {
    let team: String
    let color: Color
    var me = false
    var body: some View {
        Text(team)
            .font(.subheadline.weight(.bold).monospacedDigit())
            .padding(.horizontal, 9).padding(.vertical, 3)
            .foregroundStyle(me ? Theme.bg : color)
            .background(me ? Theme.accent : color.opacity(0.18), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct Badge: View {
    let text: String
    var tint: Color = Theme.text2
    var body: some View {
        Text(text).font(.caption2.weight(.bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(tint).background(tint.opacity(0.16), in: Capsule())
    }
}

/// Statbotics-style split bar.
struct WinBar: View {
    let pRed: Double
    var projRed: Int?
    var projBlue: Int?
    var tall = false
    var body: some View {
        let r = max(0.12, min(0.88, pRed))
        VStack(spacing: 3) {
            GeometryReader { g in
                HStack(spacing: 0) {
                    Text("\(Int((pRed * 100).rounded()))%").padding(.leading, 12).frame(width: g.size.width * r, height: g.size.height, alignment: .leading).background(Theme.red.opacity(0.95))
                    Text("\(100 - Int((pRed * 100).rounded()))%").padding(.trailing, 12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing).background(Theme.blue.opacity(0.85))
                }
                .font((tall ? Font.headline : Font.footnote).weight(.heavy)).foregroundStyle(.white)
                .clipShape(Capsule())
            }
            .frame(height: tall ? 34 : 24)
            if let projRed, let projBlue {
                HStack { Text("Red \(projRed)"); Spacer(); Text("Blue \(projBlue)") }.font(.caption2).foregroundStyle(Theme.text3).padding(.horizontal, 8)
            }
        }
    }
}

struct Stat: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(Theme.text3)
            Text(value).font(.callout.weight(.bold).monospacedDigit())
        }
    }
}

func f1(_ v: Double?) -> String { v.map { String(format: "%.1f", $0) } ?? "–" }
func pct(_ v: Double?) -> String { v.map { "\(Int(($0 * 100).rounded()))%" } ?? "–" }
func clock(_ d: Date?) -> String { d.map { $0.formatted(.dateTime.weekday(.abbreviated).hour().minute()) } ?? "–" }
func rel(_ d: Date?) -> String {
    guard let d else { return "" }
    let m = Int((d.timeIntervalSinceNow / 60).rounded())
    if abs(m) < 1 { return "now" }
    let a = abs(m)
    let t = a >= 60 ? "\(a / 60)h \(a % 60)m" : "\(a) min"
    return m > 0 ? "in \(t)" : "\(t) ago"
}
