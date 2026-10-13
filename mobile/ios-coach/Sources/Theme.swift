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

/// Thin horizontal gauge used for 0–1 rates (accuracy, climb, uptime).
struct StatBar: View {
    let label: String
    let value: Double?
    var display: String? = nil
    var tint: Color = Theme.accent
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(label).font(.caption).foregroundStyle(Theme.text3); Spacer(); Text(display ?? pct(value)).font(.caption.weight(.bold).monospacedDigit()) }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.border)
                    Capsule().fill(tint).frame(width: g.size.width * CGFloat(max(0, min(1, value ?? 0))))
                }
            }.frame(height: 6)
        }
    }
}

/// Section with a tappable header that folds its content away.
struct Collapsible<Content: View>: View {
    let title: String
    var count: Int? = nil
    var tint: Color = Theme.text3
    @State var open: Bool
    @ViewBuilder var content: Content
    init(_ title: String, count: Int? = nil, tint: Color = Theme.text3, open: Bool = true, @ViewBuilder content: () -> Content) {
        self.title = title; self.count = count; self.tint = tint; self._open = State(initialValue: open); self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                withAnimation(.snappy(duration: 0.25)) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text(title.uppercased()).font(.caption.weight(.bold)).tracking(0.6).foregroundStyle(tint)
                    if let count { Text("\(count)").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1).background(Theme.border, in: Capsule()).foregroundStyle(Theme.text2) }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.text3).rotationEffect(.degrees(open ? 90 : 0))
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            if open { content.transition(.opacity.combined(with: .move(edge: .top))) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.border))
    }
}

/// Freshness indicator for the toolbar. The toolbar already draws a glass capsule, so this is just a dot and text.
struct FreshnessPill: View {
    let date: Date?
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            let age = date.map { -$0.timeIntervalSinceNow / 60 } ?? .infinity
            let tint: Color = age < 30 ? Theme.ok : age < 180 ? Theme.warn : Theme.danger
            HStack(spacing: 6) {
                Circle().fill(tint).frame(width: 8, height: 8)
                Text(label(age)).font(.footnote.weight(.semibold)).foregroundStyle(.primary)
            }
            .padding(.horizontal, 4)
        }
    }
    private func label(_ m: Double) -> String {
        if date == nil { return "No data" }
        if m < 1 { return "Just now" }
        if m < 60 { return "\(Int(m)) min ago" }
        if m < 60 * 24 { return "\(Int(m / 60)) h ago" }
        return "\(Int(m / 1440)) d ago"
    }
}

/// "W", "L" or "T" result for a team in a played match, nil when unplayed or the team wasn't in it.
func result(of team: String, in m: CoachPack.Match) -> String? {
    guard m.played else { return nil }
    let onRed = m.red.contains(team), onBlue = m.blue.contains(team)
    guard onRed || onBlue else { return nil }
    guard let w = m.winner, w == "red" || w == "blue" else { return "T" }
    return (w == "red") == onRed ? "W" : "L"
}
