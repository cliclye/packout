import SwiftUI

struct PlanView: View {
    let pack: CoachPack
    @State private var selected: String?
    private let phases = ["Overall", "Scouting", "Defense", "Auto", "Teleop", "Endgame", "Risk"]

    private var planned: [CoachPack.Match] { pack.matches.filter { pack.plans[$0.key] != nil } }
    private var current: CoachPack.Match? {
        planned.first { $0.key == selected } ?? planned.first { !$0.played } ?? planned.last
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let m = current, let plan = pack.plans[m.key] {
                    picker(m)
                    hero(m, plan)
                    priorities(plan)
                    alliances(m, plan)
                    ForEach(phases, id: \.self) { phase in
                        let recs = plan.recs.filter { $0.phase == phase }
                        if !recs.isEmpty {
                            Collapsible(phase, count: recs.count, open: phase == "Overall" || recs.contains { $0.priority == "high" }) {
                                VStack(spacing: 8) { ForEach(recs) { RecRow(rec: $0) } }
                            }
                        }
                    }
                    if !plan.note.isEmpty { Card(title: "Match notes") { Text(plan.note) } }
                    NavigationLink(value: m) {
                        Label("Full match page", systemImage: "list.bullet.rectangle").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 6)
                    }.buttonStyle(.bordered)
                } else {
                    Card { VStack(spacing: 8) {
                        Image(systemName: "flag.checkered").font(.largeTitle).foregroundStyle(Theme.text3)
                        Text("No game plan yet").font(.headline)
                        Text(pack.myTeam.isEmpty ? "Choose your team in Packout’s Phone page and sync again." : "Team \(pack.myTeam) has no upcoming matches in the schedule.")
                            .foregroundStyle(Theme.text2).multilineTextAlignment(.center)
                    }.frame(maxWidth: .infinity).padding(.vertical, 20) }
                }
            }
            .padding(16)
            .animation(.snappy, value: selected)
        }
        .background(Theme.bg)
    }

    /// Horizontal strip of our matches; the next one is selected by default.
    private func picker(_ m: CoachPack.Match) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(planned) { x in
                        let on = x.key == m.key
                        Button { UISelectionFeedbackGenerator().selectionChanged(); selected = x.key } label: {
                            VStack(spacing: 1) {
                                Text(x.label).font(.subheadline.weight(.bold))
                                Text(x.played ? "played" : clock(x.date)).font(.caption2)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .foregroundStyle(on ? Theme.bg : Color.primary)
                            .background(on ? Theme.accent : Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                            .opacity(x.played && !on ? 0.6 : 1)
                        }.buttonStyle(.plain).id(x.key)
                    }
                }.padding(.horizontal, 2)
            }
            .onAppear { proxy.scrollTo(m.key, anchor: .center) }
        }
    }

    private func hero(_ m: CoachPack.Match, _ plan: CoachPack.Plan) -> some View {
        let pRed = plan.ourColor == "red" ? plan.pOurs : 1 - plan.pOurs
        let ourColor = plan.ourColor == "red" ? Theme.red : Theme.blue
        return Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(Int((plan.pOurs * 100).rounded()))%").font(.system(size: 52, weight: .heavy, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    Text("our win chance").font(.footnote).foregroundStyle(Theme.text3)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(m.label).font(.title3.weight(.bold))
                    if m.played {
                        Text("Final \(m.redScore ?? 0)–\(m.blueScore ?? 0)").font(.footnote).foregroundStyle(Theme.text3)
                    } else {
                        Text(clock(m.date)).font(.footnote).foregroundStyle(Theme.text3)
                        Text(rel(m.date)).font(.subheadline.weight(.bold)).foregroundStyle(Theme.accent)
                    }
                    Badge(text: "We’re \(plan.ourColor.uppercased())", tint: ourColor)
                }
            }
            WinBar(pRed: pRed, projRed: m.projRed, projBlue: m.projBlue, tall: true)
            HStack(alignment: .top, spacing: 10) {
                column("RED", m.red, Theme.red)
                column("BLUE", m.blue, Theme.blue)
            }
        }
    }

    private func column(_ title: String, _ teams: [String], _ c: Color) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(c.opacity(0.9))
            ForEach(teams, id: \.self) { t in
                Text(t).font(.title3.weight(.bold).monospacedDigit()).frame(maxWidth: .infinity).padding(.vertical, 7)
                    .foregroundStyle(t == pack.myTeam ? Theme.bg : Color.white.opacity(0.92))
                    .background(t == pack.myTeam ? Theme.accent : c.opacity(0.20), in: RoundedRectangle(cornerRadius: 10))
            }
        }.frame(maxWidth: .infinity)
    }

    /// The handful of "high" recommendations, up front, so a quick glance is enough in the queue.
    @ViewBuilder private func priorities(_ plan: CoachPack.Plan) -> some View {
        let high = plan.recs.filter { $0.priority == "high" }.prefix(3)
        if !high.isEmpty {
            Card(title: "Key points") {
                VStack(spacing: 8) { ForEach(Array(high)) { r in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.warn)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.title).font(.subheadline.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                            Text(r.detail).font(.footnote).foregroundStyle(Theme.text2).fixedSize(horizontal: false, vertical: true)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                } }
            }
        }
    }

    private func alliances(_ m: CoachPack.Match, _ plan: CoachPack.Plan) -> some View {
        let oppColor = plan.ourColor == "red" ? Theme.blue : Theme.red
        let ourColor = plan.ourColor == "red" ? Theme.red : Theme.blue
        return VStack(spacing: 14) {
            Collapsible("Opponents", count: plan.opponents.count, tint: oppColor) {
                VStack(spacing: 8) { ForEach(plan.opponents.sorted { ($0.threat ?? 0) > ($1.threat ?? 0) }) { o in
                    TeamBrief(pack: pack, member: o, color: oppColor, me: pack.myTeam, top: o.team == plan.topThreat)
                } }
            }
            Collapsible("Our alliance", count: plan.partners.count, tint: ourColor) {
                VStack(spacing: 8) { ForEach(plan.partners) { TeamBrief(pack: pack, member: $0, color: ourColor, me: pack.myTeam) } }
            }
        }
    }
}

struct RecRow: View {
    let rec: CoachPack.Plan.Rec
    private var tint: Color { rec.priority == "high" ? Theme.warn : rec.priority == "med" ? Theme.accent.opacity(0.7) : Theme.border }
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle().fill(tint).frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top) {
                    Text(rec.title).font(.subheadline.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    Badge(text: rec.priority == "high" ? "HIGH" : rec.priority == "med" ? "MED" : "FYI", tint: rec.priority == "high" ? Theme.warn : rec.priority == "med" ? Theme.accent : Theme.text3)
                }
                Text(rec.detail).font(.subheadline).foregroundStyle(Theme.text2).fixedSize(horizontal: false, vertical: true)
            }.padding(10)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

/// Compact team card; tap to open the full team page.
struct TeamBrief: View {
    let pack: CoachPack
    let member: CoachPack.Plan.Member
    let color: Color
    let me: String
    var top = false
    var body: some View {
        let t = pack.teams[member.team]
        let content = VStack(alignment: .leading, spacing: 8) {
            HStack {
                TeamChip(team: member.team, color: color, me: member.team == me)
                Text(t?.name ?? "").font(.footnote).foregroundStyle(Theme.text3).lineLimit(1)
                Spacer()
                if top { Badge(text: "TOP THREAT", tint: Theme.warn) }
                Badge(text: member.role, tint: member.role == "Unscouted" ? Theme.warn : Theme.text2)
                if t != nil { Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Theme.text3) }
            }
            if let t, t.scouted {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                    GridRow { Stat(label: "Avg pts", value: f1(t.avgPoints)); Stat(label: "Auto", value: f1(t.auto)); Stat(label: "Accuracy", value: pct(t.accuracy)) }
                    GridRow { Stat(label: "Climb", value: pct(t.climbRate)); Stat(label: "Uptime", value: pct(t.uptime)); Stat(label: "Defense", value: f1(t.defense) + "/5") }
                }
                if let s = t.strengths.first { Label(s, systemImage: "checkmark").font(.footnote).foregroundStyle(Theme.ok) }
                if let r = t.risks.first { Label(r, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Theme.warn) }
            } else if let t {
                HStack(spacing: 18) { Stat(label: "Rating", value: f1(t.rating)); Stat(label: "TBA rank", value: t.tbaRank.map(String.init) ?? "–"); Stat(label: "OPR", value: f1(t.opr)) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 4) }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        if let t { NavigationLink(value: t) { content }.buttonStyle(.plain) } else { content }
    }
}

/// Wraps chips onto multiple lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > width && x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
        return CGSize(width: width, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX && x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
