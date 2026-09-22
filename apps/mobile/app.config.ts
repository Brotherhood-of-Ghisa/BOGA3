import { ExpoConfig } from 'expo/config';

const DEFAULT_BOGA_AGENT_CONNECT_URL =
    "https://sparkling-violet-dc56.sboschianpest.workers.dev/connect";

function resolveAndroidPackage(): string {
    if (process.env.ANDROID_PACKAGE) {
        return process.env.ANDROID_PACKAGE;
    }
    // Fail closed: production builds must never silently inherit the dev package ID.
    if (
        process.env.IOS_BUNDLE_ID === "com.phano.boga3" ||
        (process.env.APP_ENV === "prod" && process.env.IOS_BUNDLE_ID !== "com.phano.boga3.dev")
    ) {
        throw new Error(
            "ANDROID_PACKAGE must be explicitly defined for production builds (expected com.phano.boga3)."
        );
    }
    return "com.phano.boga3.dev";
}

// The design-language typefaces (docs/specs/ui/design-language.md §3),
// embedded in the binary by the expo-font config plugin so the OS registers
// them before JS runs: no runtime load, no splash gate, no flash of the system
// font. `family` is each file's typographic family name (name ID 16) — iOS
// groups embedded faces under it and picks a face by `fontWeight`, and the
// Android XML family below is registered under the same string, so
// `{ fontFamily, fontWeight }` resolves identically on both. `uiFonts` in
// components/ui/tokens.ts is the app-side vocabulary for these faces;
// app/__tests__/ui-fonts-embedded.test.ts holds the three in step.
const EMBEDDED_FONT_FACES = [
    { family: "Archivo", weight: 600, file: "archivo/600SemiBold/Archivo_600SemiBold.ttf" },
    { family: "Archivo", weight: 700, file: "archivo/700Bold/Archivo_700Bold.ttf" },
    { family: "Archivo", weight: 800, file: "archivo/800ExtraBold/Archivo_800ExtraBold.ttf" },
    { family: "Source Sans 3", weight: 400, file: "source-sans-3/400Regular/SourceSans3_400Regular.ttf" },
    { family: "Source Sans 3", weight: 600, file: "source-sans-3/600SemiBold/SourceSans3_600SemiBold.ttf" },
    { family: "IBM Plex Mono", weight: 500, file: "ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf" },
    { family: "IBM Plex Mono", weight: 600, file: "ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf" },
    { family: "IBM Plex Mono", weight: 700, file: "ibm-plex-mono/700Bold/IBMPlexMono_700Bold.ttf" },
] as const;

function embeddedFontPath(file: string): string {
    return `./node_modules/@expo-google-fonts/${file}`;
}

// iOS takes a flat file list (Info.plist `UIAppFonts`). Android takes one XML
// font family per `fontFamily`, which is what lets `fontWeight` pick the face
// there too — a flat file list would register each file under its file name.
function embeddedFontsPluginProps() {
    const families = [...new Set(EMBEDDED_FONT_FACES.map((face) => face.family))];
    return {
        ios: {
            fonts: EMBEDDED_FONT_FACES.map((face) => embeddedFontPath(face.file)),
        },
        android: {
            fonts: families.map((family) => ({
                fontFamily: family,
                fontDefinitions: EMBEDDED_FONT_FACES.filter((face) => face.family === family).map(
                    (face) => ({ path: embeddedFontPath(face.file), weight: face.weight })
                ),
            })),
        },
    };
}

export default ({ config }: { config: ExpoConfig }) => ({
    ...config,

    name: process.env.APP_NAME ?? "Boga3",
    slug: "boga3",
    version: "1.1.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "boga3",
    // Light-only by decision (2026-09-19). Dark mode is explicitly not a
    // product goal, and "automatic" is not free: it hands the OS-owned
    // chrome — Alert.alert dialogs, the keyboard, native pickers — a dark
    // appearance over an app that renders one light theme. Pinning "light"
    // keeps that chrome consistent with the tokens in
    // components/ui/tokens.ts, which have no dark variants.
    userInterfaceStyle: "light",
    newArchEnabled: true,

    ios: {
        supportsTablet: true,
        infoPlist: {
            ITSAppUsesNonExemptEncryption: false
        },
        bundleIdentifier: process.env.IOS_BUNDLE_ID ?? "com.anonymous.boga3",
        buildNumber: process.env.IOS_BUILD_NUMBER ?? "1"
    },

    android: {
        package: resolveAndroidPackage(),
        adaptiveIcon: {
            backgroundColor: "#E6F4FE",
            foregroundImage: "./assets/images/android-icon-foreground.png",
            backgroundImage: "./assets/images/android-icon-background.png",
            monochromeImage: "./assets/images/android-icon-monochrome.png"
        },
        edgeToEdgeEnabled: true,
        predictiveBackGestureEnabled: false
    },

    web: {
        output: "static",
        favicon: "./assets/images/favicon.png"
    },

    plugins: [
        "expo-dev-client",
        "expo-router",
        [
            "expo-splash-screen",
            {
                image: "./assets/images/splash-icon.png",
                imageWidth: 200,
                resizeMode: "contain",
                // No `dark` variant: a dark splash makes expo-splash-screen
                // force UIUserInterfaceStyle=Automatic into Info.plist,
                // silently overriding the `userInterfaceStyle: "light"` above
                // (prebuild warns "preventing splash screen from working
                // properly"). Light-only is the decision, so the dark
                // background goes.
                backgroundColor: "#ffffff"
            }
        ],
        "expo-secure-store",
        [
            "expo-location",
            {
                locationWhenInUsePermission:
                    "Allow Boga3 to use your location while the app is open to suggest your current gym.",
                isIosBackgroundLocationEnabled: false,
                isAndroidBackgroundLocationEnabled: false,
                isAndroidForegroundServiceEnabled: false
            }
        ],
        "expo-background-task",
        ["expo-font", embeddedFontsPluginProps()]
    ],

    experiments: {
        typedRoutes: true,
        reactCompiler: true
    },

    owner: "brotherhood-of-ghisa",

    extra: {
        env: process.env.APP_ENV,
        releaseCodename: "Jemiliano",
        bogaAgentConnectUrl:
            process.env.EXPO_PUBLIC_BOGA_AGENT_CONNECT_URL?.trim() ||
            DEFAULT_BOGA_AGENT_CONNECT_URL,
        eas: {
            projectId: "3c00cd23-0946-4eb6-bbf0-4542879cd314"
        },
    }


});
