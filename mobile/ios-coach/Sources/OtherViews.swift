import SwiftUI

struct MatchesView: View {
    let pack: CoachPack
    @State private var filter = "upcoming"
    @State private var search = ""

    private var list: [CoachPack.Match] {
        var items = pack.matches.filter { m in
            switch filter {
            case "upcoming": if m.played { return false }
            case "results": if !m.played { return false }
            case "mine": if !(m.red + m.blue).contains(pack.myTeam) { return false }
            default: break
            }
            return search.isEmpty || (m.red + m.blue).contains { $0.hasPrefix(search) }
        }
        if filter == "results" { items.reverse() }
        return items
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Picker("", selection: $filter) {
                    Text("Next").tag("upcoming"); Text("Results").tag("results"); Text("Mine").tag("mine"); Text("All").tag("all")
                }.pickerStyle(.segmented)
                TextField("Filter by team #", text: $search).keyboardType(.numberPad).textFieldStyle(.roundedBorder)
                LazyVStack(spacing: 8) { ForEach(list.prefix(150)) { MatchRow(m: $0, me: pack.myTeam) } }
                if list.isEmpty { Text("Nothing here.").foregroundStyle(Theme.text3).padding(30) }
            }.padding(16)
        }
    }
}

struct MatchRow: View {
    let m: CoachPack.Match
    let me: String
    var body: some View {
        let mine = (m.red + m.blue).contains(me)
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text(m.label).font(.subheadline.weight(.bold)); Spacer(); if !m.played { Text("\(clock(m.date)) · \(rel(m.date))").font(.caption).foregroundStyle(Theme.text3) } }
            side(m.red, Theme.red, m.redScore, m.winner == "red")
            side(m.blue, Theme.blue, m.blueScore, m.winner == "blue")
            if !m.played { WinBar(pRed: m.pRed, projRed: m.projRed, projBlue: m.projBlue) }
        }
        .padding(12)
        .background(mine ? Theme.accent.opacity(0.10) : Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(mine ? Theme.accent.opacity(0.6) : Theme.border))
    }
    private func side(_ teams: [String], _ c: Color, _ score: Int?, _ won: Bool) -> some View {
        HStack { FlowLayout(spacing: 5) { ForEach(teams, id: \.self) { TeamChip(team: $0, color: c, me: $0 == me) } }; Spacer()
            if let score { Text("\(score)").font(.title3.weight(won ? .heavy : .semibold).monospacedDigit()).foregroundStyle(won ? Color.primary : Theme.text3) } }
    }
}

struct TeamsView: View {
    let pack: CoachPack
    @State private var search = ""
    private var teams: [CoachPack.TeamEntry] {
        pack.teams.values.filter { search.isEmpty || $0.number.hasPrefix(search) || ($0.name ?? "").localizedCaseInsensitiveContains(search) }
            .sorted { (Int($0.number) ?? 0) < (Int($1.number) ?? 0) }
    }
    var body: some View {
        NavigationStack {
            List(teams) { t in
                NavigationLink(value: t.number) {
                    HStack {
                        VStack(alignment: .leading) { Text(t.number).font(.headline.monospacedDigit()); Text(t.name ?? "").font(.caption).foregroundStyle(Theme.text3).lineLimit(1) }
                        Spacer()
                        Text(t.scouted ? "\(f1(t.avgPoints)) pts" : "OPR \(f1(t.opr))").font(.footnote).foregroundStyle(Theme.text3)
                    }
                }.listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden).background(Theme.bg)
            .searchable(text: $search, prompt: "Team # or name")
            .navigationDestination(for: String.self) { n in if let t = pack.teams[n] { TeamDetailView(t: t) } }
            .navigationTitle("Teams").navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct TeamDetailView: View {
    let t: CoachPack.TeamEntry
    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Card {
                    HStack { VStack(alignment: .leading) { Text(t.number).font(.system(size: 40, weight: .heavy, design: .rounded)); Text(t.name ?? "").foregroundStyle(Theme.text3) }
                        Spacer(); Badge(text: t.scouted ? "\(t.matches) scouted" : "no scouting", tint: t.scouted ? Theme.ok : Theme.warn) }
                    Grid(alignment: .leading, horizontalSpacing: 22, verticalSpacing: 10) {
                        GridRow { Stat(label: "Avg pts", value: f1(t.avgPoints)); Stat(label: "Auto", value: f1(t.auto)); Stat(label: "Endgame", value: f1(t.endgame)) }
                        GridRow { Stat(label: "Accuracy", value: pct(t.accuracy)); Stat(label: "Climb", value: pct(t.climbRate)); Stat(label: "Uptime", value: pct(t.uptime)) }
                        GridRow { Stat(label: "Defense", value: f1(t.defense)); Stat(label: "TBA rank", value: t.tbaRank.map(String.init) ?? "–"); Stat(label: "OPR", value: f1(t.opr)) }
                    }
                }
                if !t.strengths.isEmpty { Card(title: "Strengths") { ForEach(t.strengths, id: \.self) { Label($0, systemImage: "checkmark").foregroundStyle(Theme.ok).font(.subheadline) } } }
                if !t.risks.isEmpty { Card(title: "Watch-outs") { ForEach(t.risks, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.warn).font(.subheadline) } } }
            }.padding(16)
        }
        .background(Theme.bg).navigationTitle("Team \(t.number)").navigationBarTitleDisplayMode(.inline)
    }
}

struct RanksView: View {
    let pack: CoachPack
    var body: some View {
        List(pack.rankings) { r in
            HStack {
                Text("\(r.rank)").font(.headline.monospacedDigit()).frame(width: 34, alignment: .leading)
                Text(r.team).font(.headline.monospacedDigit())
                Spacer()
                Text(r.record).monospacedDigit().foregroundStyle(Theme.text2)
            }.listRowBackground(r.team == pack.myTeam ? Theme.accent.opacity(0.18) : Theme.surface)
        }
        .scrollContentBackground(.hidden).background(Theme.bg)
        .overlay { if pack.rankings.isEmpty { Text("No rankings yet").foregroundStyle(Theme.text3) } }
    }
}
