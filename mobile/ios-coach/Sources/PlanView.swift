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
                    ForEach(phases, id: \.self) { phase in
                        let recs = plan.recs.filter { $0.phase == phase }
                        if !recs.isEmpty {
                            Card(title: phase) {
                                ForEach(recs) { r in RecRow(rec: r) }
                            }
                        }
                    }
                    let oppColor = plan.ourColor == "red" ? Theme.blue : Theme.red
                    let ourColor = plan.ourColor == "red" ? Theme.red : Theme.blue
                    Card(title: "Opponents") {
                        ForEach(plan.opponents.sorted { ($0.threat ?? 0) > ($1.threat ?? 0) }) { o in
                            TeamBrief(pack: pack, member: o, color: oppColor, me: pack.myTeam)
                        }
                    }
                    Card(title: "Our alliance") {
                        ForEach(plan.partners) { o in TeamBrief(pack: pack, member: o, color: ourColor, me: pack.myTeam) }
                    }
                    if !plan.note.isEmpty { Card(title: "Match notes") { Text(plan.note) } }
                } else {
                    Card { VStack(spacing: 8) {
                        Text("No game plan yet").font(.headline)
                        Text(pack.myTeam.isEmpty ? "Choose your team in Packout’s Phone page and sync again." : "Team \(pack.myTeam) has no upcoming matches in the schedule.")
                            .foregroundStyle(Theme.text2).multilineTextAlignment(.center)
                    }.frame(maxWidth: .infinity).padding(.vertical, 20) }
                }
            }
            .padding(16)
        }
    }

    private func picker(_ m: CoachPack.Match) -> some View {
        Menu {
            ForEach(planned) { x in
                Button { selected = x.key } label: { Text("\(x.label) — \(x.played ? "played" : clock(x.date))") }
            }
        } label: {
            HStack { Text("\(m.label) · \(m.played ? "played" : clock(m.date))"); Spacer(); Image(systemName: "chevron.up.chevron.down").font(.caption) }
                .padding(12).background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
        }.foregroundStyle(.primary)
    }

    private func hero(_ m: CoachPack.Match, _ plan: CoachPack.Plan) -> some View {
        let pRed = plan.ourColor == "red" ? plan.pOurs : 1 - plan.pOurs
        return Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(Int((plan.pOurs * 100).rounded()))%").font(.system(size: 44, weight: .heavy, design: .rounded)).monospacedDigit()
                    Text("our win chance").font(.footnote).foregroundStyle(Theme.text3)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(m.label).font(.headline)
                    Text(m.played ? "Final \(m.redScore ?? 0)–\(m.blueScore ?? 0)" : "\(clock(m.date)) · \(rel(m.date))").font(.footnote).foregroundStyle(Theme.text3)
                }
            }
            WinBar(pRed: pRed, projRed: m.projRed, projBlue: m.projBlue, tall: true)
            FlowLayout(spacing: 6) {
                ForEach(m.red, id: \.self) { TeamChip(team: $0, color: Theme.red, me: $0 == pack.myTeam) }
                Text("vs").font(.footnote).foregroundStyle(Theme.text3)
                ForEach(m.blue, id: \.self) { TeamChip(team: $0, color: Theme.blue, me: $0 == pack.myTeam) }
            }
        }
    }
}

struct RecRow: View {
    let rec: CoachPack.Plan.Rec
    private var tint: Color { rec.priority == "high" ? Theme.danger : rec.priority == "med" ? Theme.accent : Theme.border }
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle().fill(tint).frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top) {
                    Text(rec.title).font(.subheadline.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    Badge(text: rec.priority == "high" ? "HIGH" : rec.priority == "med" ? "MED" : "FYI", tint: rec.priority == "high" ? Theme.danger : rec.priority == "med" ? Theme.accent : Theme.text2)
                }
                Text(rec.detail).font(.subheadline).foregroundStyle(Theme.text2).fixedSize(horizontal: false, vertical: true)
            }.padding(10)
        }
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct TeamBrief: View {
    let pack: CoachPack
    let member: CoachPack.Plan.Member
    let color: Color
    let me: String
    var body: some View {
        let t = pack.teams[member.team]
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TeamChip(team: member.team, color: color, me: member.team == me)
                Text(t?.name ?? "").font(.footnote).foregroundStyle(Theme.text3).lineLimit(1)
                Spacer()
                Badge(text: member.role, tint: member.role == "Unscouted" ? Theme.warn : Theme.text2)
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
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 4).clipShape(RoundedRectangle(cornerRadius: 2)) }
        .clipShape(RoundedRectangle(cornerRadius: 12))
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
