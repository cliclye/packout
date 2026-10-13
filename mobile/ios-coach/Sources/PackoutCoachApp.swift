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
            tabRoot(title: store.pack?.event?.name ?? "Next match") { PlanView(pack: $0) }
                .tabItem { Label("Plan", systemImage: "scope") }.tag(0)
            tabRoot(title: "Matches") { MatchesView(pack: $0) }
                .tabItem { Label("Matches", systemImage: "calendar") }.tag(1)
            tabRoot(title: "Teams") { TeamsView(pack: $0) }
                .tabItem { Label("Teams", systemImage: "gearshape.2") }.tag(2)
            tabRoot(title: "Rankings") { RanksView(pack: $0) }
                .tabItem { Label("Ranks", systemImage: "trophy") }.tag(3)
            NavigationStack { ConnectView().navTitle("Get data") }
                .tabItem { Label("Data", systemImage: "arrow.down.circle") }.tag(4)
        }
        .tint(Theme.accent)
        .task(id: store.syncBase) {
            // Keep fresh while the app is open and Packout is reachable; stay silent when it isn't.
            while !Task.isCancelled {
                if phase == .active { await store.sync(silent: true) }
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .onChange(of: store.pack) { _, new in
            if new != nil && tab == 4 {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                withAnimation { tab = 0 }
            }
        }
    }

    /// One navigation stack per tab so match and team pages push inside the tab you were on.
    private func tabRoot<C: View>(title: String, @ViewBuilder _ content: @escaping (CoachPack) -> C) -> some View {
        NavigationStack {
            Group {
                if let p = store.pack { content(p).coachDestinations(p) } else { Welcome(goConnect: { tab = 4 }) }
            }
            .navTitle(title)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { StatusButton() } }
        }
    }
}

extension View {
    func navTitle(_ t: String) -> some View {
        self.navigationTitle(t).navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.bg, for: .navigationBar).toolbarBackground(.visible, for: .navigationBar)
            .background(Theme.bg)
    }
    /// Every match / team row in the app pushes through these two destinations.
    func coachDestinations(_ pack: CoachPack) -> some View {
        self.navigationDestination(for: CoachPack.Match.self) { MatchDetailView(pack: pack, match: $0) }
            .navigationDestination(for: CoachPack.TeamEntry.self) { TeamDetailView(pack: pack, t: $0) }
    }
}

/// Freshness pill; doubles as the refresh button when a Wi-Fi link is configured.
struct StatusButton: View {
    @EnvironmentObject var store: PackStore
    var body: some View {
        Button {
            if store.hasConnection { Task { await store.sync() } }
        } label: {
            if store.syncing { ProgressView().controlSize(.small) } else { FreshnessPill(date: store.lastSync) }
        }.buttonStyle(.plain)
    }
}

struct Welcome: View {
    var goConnect: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "scope").font(.system(size: 52)).foregroundStyle(Theme.accent)
            Text("No match data yet").font(.title2.weight(.bold))
            Text("Scan the moving QR code in Packout on your computer. No Wi-Fi needed.").foregroundStyle(Theme.text2).multilineTextAlignment(.center)
            Button { goConnect() } label: { Label("Get data", systemImage: "qrcode.viewfinder").font(.headline).padding(.horizontal, 12).padding(.vertical, 4) }
                .buttonStyle(.borderedProminent)
        }.padding(40).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.bg)
    }
}
