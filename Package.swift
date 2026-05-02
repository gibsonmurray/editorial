// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Editorial",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Editorial", targets: ["Editorial"])
    ],
    targets: [
        .executableTarget(
            name: "Editorial",
            path: "Sources/Editorial"
        )
    ]
)
