import SwiftUI

// MARK: Matches

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
                Picker("", selection: $filter.animation(.snappy)) {
                    Text("Next").tag("upcoming"); Text("Results").tag("results"); Text("Ours").tag("mine"); Text("All").tag("all")
                }.pickerStyle(.segmented)
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.text3)
                    TextField("Filter by team #", text: $search).keyboardType(.numberPad)
                    if !search.isEmpty { Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.text3) } }
                }.padding(10).background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                LazyVStack(spacing: 8) {
                    ForEach(Array(list.prefix(150).enumerated()), id: \.element.id) { i, m in
                        NavigationLink(value: m) { MatchRow(m: m, me: pack.myTeam, next: filter == "upcoming" && i == 0) }.buttonStyle(.plain)
                    }
                }
                if list.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "calendar.badge.exclamationmark").font(.title).foregroundStyle(Theme.text3)
                        Text("No matches here").foregroundStyle(Theme.text3)
                    }.padding(40)
                }
            }.padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg)
    }
}

struct MatchRow: View {
    let m: CoachPack.Match
    let me: String
    var next = false
    var body: some View {
        let mine = (m.red + m.blue).contains(me)
        let res = result(of: me, in: m)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(m.label).font(.subheadline.weight(.bold))
                if next { Badge(text: "NEXT", tint: Theme.accent) }
                if mine { Badge(text: "OURS", tint: Theme.accent) }
                if let res { Badge(text: res == "W" ? "WIN" : res == "L" ? "LOSS" : "TIE", tint: res == "W" ? Theme.ok : res == "L" ? Theme.danger : Theme.text2) }
                Spacer()
                if !m.played { Text("\(clock(m.date)) · \(rel(m.date))").font(.caption).foregroundStyle(Theme.text3) }
                Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Theme.text3)
            }
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

/// Everything about one match: prediction, both alliances with scouting, and our plan if we play in it.
struct MatchDetailView: View {
    let pack: CoachPack
    let match: CoachPack.Match

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Card {
                    HStack {
                        Text(match.label).font(.title2.weight(.bold))
                        Spacer()
                        if match.played { Text("Final \(match.redScore ?? 0)–\(match.blueScore ?? 0)").font(.headline.monospacedDigit()) }
                        else { VStack(alignment: .trailing) { Text(clock(match.date)); Text(rel(match.date)).foregroundStyle(Theme.accent).font(.subheadline.weight(.bold)) } }
                    }
                    WinBar(pRed: match.pRed, projRed: match.projRed, projBlue: match.projBlue, tall: true)
                    if match.played { Text("Pre-match prediction shown above").font(.caption).foregroundStyle(Theme.text3) }
                }
                if let plan = pack.plans[match.key] {
                    let high = plan.recs.filter { $0.priority == "high" }
                    if !high.isEmpty {
                        Card(title: "Our key points") { VStack(spacing: 8) { ForEach(high) { RecRow(rec: $0) } } }
                    }
                }
                alliance("Red alliance", match.red, Theme.red)
                alliance("Blue alliance", match.blue, Theme.blue)
            }.padding(16)
        }
        .background(Theme.bg).navTitle(match.label)
    }

    private func alliance(_ title: String, _ teams: [String], _ c: Color) -> some View {
        Collapsible(title, count: teams.count, tint: c) {
            VStack(spacing: 8) {
                ForEach(teams, id: \.self) { n in
                    TeamBrief(pack: pack, member: .init(team: n, role: pack.teams[n]?.role ?? (pack.teams[n]?.scouted == true ? "Scouted" : "Unscouted"), threat: nil), color: c, me: pack.myTeam)
                }
            }
        }
    }
}

// MARK: Teams

struct TeamsView: View {
    let pack: CoachPack
    @State private var search = ""
    @State private var sort = "number"

    private var teams: [CoachPack.TeamEntry] {
        let f = pack.teams.values.filter { search.isEmpty || $0.number.hasPrefix(search) || ($0.name ?? "").localizedCaseInsensitiveContains(search) }
        switch sort {
        case "points": return f.sorted { ($0.avgPoints ?? $0.opr ?? -1) > ($1.avgPoints ?? $1.opr ?? -1) }
        case "rank": return f.sorted { ($0.tbaRank ?? 999) < ($1.tbaRank ?? 999) }
        default: return f.sorted { (Int($0.number) ?? 0) < (Int($1.number) ?? 0) }
        }
    }

    var body: some View {
        List {
            Section {
                Picker("Sort", selection: $sort.animation(.snappy)) { Text("Number").tag("number"); Text("Points").tag("points"); Text("Rank").tag("rank") }.pickerStyle(.segmented)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            Section {
                ForEach(teams) { t in
                    NavigationLink(value: t) {
                        HStack(spacing: 12) {
                            Text(t.number).font(.headline.monospacedDigit()).foregroundStyle(t.number == pack.myTeam ? Theme.accent : Color.primary).frame(width: 58, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.name ?? "").font(.subheadline).lineLimit(1)
                                HStack(spacing: 5) {
                                    if t.number == pack.myTeam { Badge(text: "US", tint: Theme.accent) }
                                    if let r = t.role, t.scouted { Badge(text: r) } else if !t.scouted { Badge(text: "No scouting", tint: Theme.warn) }
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(t.scouted ? f1(t.avgPoints) : f1(t.opr)).font(.callout.weight(.bold).monospacedDigit())
                                Text(t.scouted ? "avg pts" : "OPR").font(.caption2).foregroundStyle(Theme.text3)
                            }
                        }
                    }.listRowBackground(t.number == pack.myTeam ? Theme.accent.opacity(0.12) : Theme.surface)
                }
            }
        }
        .scrollContentBackground(.hidden).background(Theme.bg)
        .searchable(text: $search, prompt: "Team # or name")
        .overlay { if teams.isEmpty { Text("No teams match").foregroundStyle(Theme.text3) } }
    }
}

struct TeamDetailView: View {
    let pack: CoachPack
    let t: CoachPack.TeamEntry

    private var theirMatches: [CoachPack.Match] { pack.matches.filter { ($0.red + $0.blue).contains(t.number) } }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Card {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.number).font(.system(size: 42, weight: .heavy, design: .rounded))
                            Text(t.name ?? "").foregroundStyle(Theme.text3)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 5) {
                            Badge(text: t.scouted ? "\(t.matches) scouted" : "no scouting", tint: t.scouted ? Theme.ok : Theme.warn)
                            if let r = t.role { Badge(text: r) }
                            if let r = t.risk { Badge(text: r, tint: Theme.warn) }
                        }
                    }
                    Grid(alignment: .leading, horizontalSpacing: 22, verticalSpacing: 10) {
                        GridRow { Stat(label: "Avg pts", value: f1(t.avgPoints)); Stat(label: "Auto", value: f1(t.auto)); Stat(label: "Tele", value: f1(t.tele)) }
                        GridRow { Stat(label: "Endgame", value: f1(t.endgame)); Stat(label: "TBA rank", value: t.tbaRank.map(String.init) ?? "–"); Stat(label: "OPR", value: f1(t.opr)) }
                    }
                }
                if t.scouted {
                    Card(title: "Reliability") {
                        VStack(spacing: 10) {
                            StatBar(label: "Shooting accuracy", value: t.accuracy, tint: Theme.ok)
                            StatBar(label: "Climb rate", value: t.climbRate, tint: Theme.accent)
                            StatBar(label: "Uptime", value: t.uptime, tint: Theme.blue)
                            StatBar(label: "Defense", value: t.defense.map { $0 / 5 }, display: f1(t.defense) + " / 5", tint: Theme.warn)
                        }
                    }
                }
                if !t.strengths.isEmpty { Card(title: "Strengths") { ForEach(t.strengths, id: \.self) { Label($0, systemImage: "checkmark").foregroundStyle(Theme.ok).font(.subheadline) } } }
                if !t.risks.isEmpty { Card(title: "Watch-outs") { ForEach(t.risks, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.warn).font(.subheadline) } } }
                if !theirMatches.isEmpty {
                    Collapsible("Matches", count: theirMatches.count, open: false) {
                        VStack(spacing: 8) { ForEach(theirMatches) { m in
                            NavigationLink(value: m) {
                                HStack {
                                    Text(m.label).font(.subheadline.weight(.semibold))
                                    if let r = result(of: t.number, in: m) { Badge(text: r, tint: r == "W" ? Theme.ok : r == "L" ? Theme.danger : Theme.text2) }
                                    Spacer()
                                    Text(m.played ? "\(m.redScore ?? 0)–\(m.blueScore ?? 0)" : clock(m.date)).font(.footnote.monospacedDigit()).foregroundStyle(Theme.text3)
                                    Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Theme.text3)
                                }.padding(10).background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                            }.buttonStyle(.plain)
                        } }
                    }
                }
            }.padding(16)
        }
        .background(Theme.bg).navTitle("Team \(t.number)")
    }
}

// MARK: Rankings

struct RanksView: View {
    let pack: CoachPack
    private var mine: CoachPack.Rank? { pack.rankings.first { $0.team == pack.myTeam } }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if let m = mine {
                    Section {
                        Button { withAnimation { proxy.scrollTo(m.rank, anchor: .center) } } label: {
                            HStack {
                                VStack(alignment: .leading) { Text("#\(m.rank)").font(.system(size: 34, weight: .heavy, design: .rounded)); Text("Team \(m.team)").font(.footnote).foregroundStyle(Theme.text3) }
                                Spacer()
                                VStack(alignment: .trailing) { Text(m.record).font(.title3.weight(.bold).monospacedDigit()); Text("\(m.played) played").font(.footnote).foregroundStyle(Theme.text3) }
                            }
                        }.buttonStyle(.plain).listRowBackground(Theme.accent.opacity(0.16))
                    }
                }
                Section {
                    ForEach(pack.rankings) { r in
                        let row = HStack {
                            Text("\(r.rank)").font(.headline.monospacedDigit()).frame(width: 34, alignment: .leading).foregroundStyle(r.rank <= 8 ? Theme.ok : Color.primary)
                            Text(r.team).font(.headline.monospacedDigit())
                            Spacer()
                            Text(r.record).monospacedDigit().foregroundStyle(Theme.text2)
                        }
                        Group {
                            if let t = pack.teams[r.team] { NavigationLink(value: t) { row } } else { row }
                        }
                        .id(r.rank)
                        .listRowBackground(r.team == pack.myTeam ? Theme.accent.opacity(0.18) : Theme.surface)
                    }
                } footer: { if !pack.rankings.isEmpty { Text("Top 8 (green) are the alliance captains.").font(.caption) } }
            }
            .scrollContentBackground(.hidden).background(Theme.bg)
            .overlay { if pack.rankings.isEmpty { Text("No rankings yet").foregroundStyle(Theme.text3) } }
        }
    }
}
