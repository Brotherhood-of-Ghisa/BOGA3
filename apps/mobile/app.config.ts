import { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig }) => ({
    ...config,

    name: process.env.APP_NAME ?? "Boga3",
    slug: "boga3",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "boga3",
    userInterfaceStyle: "automatic",
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
        package: process.env.ANDROID_PACKAGE,
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
                backgroundColor: "#ffffff",
                dark: {
                    backgroundColor: "#000000"
                }
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
        ]
    ],

    experiments: {
        typedRoutes: true,
        reactCompiler: true
    },

    owner: "brotherhood-of-ghisa",

    extra: {
        env: process.env.APP_ENV,
        eas: {
            projectId: "3c00cd23-0946-4eb6-bbf0-4542879cd314"
        },
    }


});
