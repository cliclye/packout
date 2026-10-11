import SwiftUI

@main
struct PackoutCoachApp: App {
    @StateObject private var store = PackStore()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onOpenURL { url in store.importFile(url) }   // "Open in Packout Coach" from AirDrop / Files
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: PackStore
    @Environment(\.scenePhase) private var phase
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            screen { if let p = store.pack { PlanView(pack: p) } else { Welcome() } }.tabItem { Label("Plan", systemImage: "scope") }.tag(0)
            screen { if let p = store.pack { MatchesView(pack: p) } else { Welcome() } }.tabItem { Label("Matches", systemImage: "calendar") }.tag(1)
            Group { if let p = store.pack { TeamsView(pack: p) } else { Welcome() } }.tabItem { Label("Teams", systemImage: "gearshape.2") }.tag(2)
            screen { if let p = store.pack { RanksView(pack: p) } else { Welcome() } }.tabItem { Label("Ranks", systemImage: "trophy") }.tag(3)
            screen { ConnectView() }.tabItem { Label("Connect", systemImage: "antenna.radiowaves.left.and.right") }.tag(4)
        }
        .tint(Theme.accent)
        .task(id: store.syncBase) {
            // Keep fresh while the app is open and Packout is reachable; stay silent when it isn't.
            while !Task.isCancelled {
                if phase == .active { await store.sync(silent: true) }
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .onChange(of: store.pack) { _, new in if new != nil && tab == 4 { tab = 0 } }
    }

    private func screen<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 0) {
            Header()
            content()
        }.background(Theme.bg)
    }
}

struct Header: View {
    @EnvironmentObject var store: PackStore
    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(store.pack?.event?.name ?? store.pack?.competition.name ?? "Packout Coach").font(.headline).lineLimit(1)
                Text(sub).font(.caption).foregroundStyle(Theme.text3)
            }
            Spacer()
            if store.hasConnection {
                Button { Task { await store.sync() } } label: {
                    if store.syncing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }.buttonStyle(.bordered)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
    }
    private var sub: String {
        guard let p = store.pack else { return "No data yet" }
        let t = store.lastSync.map { "Updated \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
        return [t, p.myTeam.isEmpty ? nil : "Team \(p.myTeam)"].compactMap { $0 }.joined(separator: " · ")
    }
}

struct Welcome: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "scope").font(.system(size: 44)).foregroundStyle(Theme.accent)
            Text("No match data yet").font(.title3.weight(.bold))
            Text("Open the Connect tab to link Packout on your computer, or import a coach file.").foregroundStyle(Theme.text2).multilineTextAlignment(.center)
        }.padding(40).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.bg)
    }
}
