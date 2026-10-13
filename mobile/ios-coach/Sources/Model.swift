import Foundation

/// Mirrors the "coach pack" JSON written by Packout (format v1). Everything optional-tolerant so
/// newer Packout versions can add fields without breaking older app builds.
struct CoachPack: Codable, Equatable {
    var format: String
    var version: Int
    var generatedAt: String
    var competition: Competition
    var event: EventInfo?
    var myTeam: String
    var summary: Summary
    var matches: [Match]
    var teams: [String: TeamEntry]
    var plans: [String: Plan]
    var rankings: [Rank]

    struct Competition: Codable, Equatable { var name: String; var eventKey: String }
    struct EventInfo: Codable, Equatable { var name: String; var city: String?; var start: String?; var end: String? }
    struct Summary: Codable, Equatable {
        var qualsPlayed: Int
        var qualsTotal: Int
        var myRank: Int?
        var myRecord: String?
        var model: ModelInfo?
        struct ModelInfo: Codable, Equatable { var accuracy: Double; var graded: Int }
    }

    struct Match: Codable, Hashable, Identifiable {
        var key: String
        var label: String
        var level: String
        var number: Int
        var time: Double?
        var red: [String]
        var blue: [String]
        var played: Bool
        var redScore: Int?
        var blueScore: Int?
        var winner: String?
        var pRed: Double
        var projRed: Int
        var projBlue: Int
        var video: String?
        var id: String { key }
        var date: Date? { time.map { Date(timeIntervalSince1970: $0 / 1000) } }
    }

    struct TeamEntry: Codable, Hashable, Identifiable {
        var number: String
        var name: String?
        var scouted: Bool
        var matches: Int
        var rank: Int?
        var pickScore: Double?
        var role: String?
        var risk: String?
        var rating: Double?
        var tbaRank: Int?
        var record: String?
        var opr: Double?
        var avgPoints: Double?
        var auto: Double?
        var tele: Double?
        var endgame: Double?
        var accuracy: Double?
        var climbRate: Double?
        var uptime: Double?
        var defense: Double?
        var strengths: [String]
        var risks: [String]
        var startLeft: Double?
        var id: String { number }
    }

    struct Plan: Codable, Equatable {
        var ourColor: String
        var pOurs: Double
        var ourExpected: Int
        var oppExpected: Int
        var topThreat: String?
        var partners: [Member]
        var opponents: [Member]
        var recs: [Rec]
        var note: String
        struct Member: Codable, Equatable, Identifiable { var team: String; var role: String; var threat: Double?; var id: String { team } }
        struct Rec: Codable, Equatable, Identifiable {
            var phase: String
            var priority: String
            var title: String
            var detail: String
            var id: String { phase + title }
        }
    }

    struct Rank: Codable, Equatable, Identifiable { var rank: Int; var team: String; var record: String; var played: Int; var id: Int { rank } }

    var generated: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: generatedAt) ?? ISO8601DateFormatter().date(from: generatedAt)
    }
}
