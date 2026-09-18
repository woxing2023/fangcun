plugins {
    id("com.android.application")
}

val releaseStoreFile = System.getenv("FANGCUN_KEYSTORE_PATH")
val releaseStorePassword = System.getenv("FANGCUN_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("FANGCUN_KEY_ALIAS")
val releaseKeyPassword = System.getenv("FANGCUN_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "top.woxingsf.fangcun"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "top.woxingsf.fangcun"
        minSdk = 26
        targetSdk = 36
        versionCode = 33
        versionName = "2.7.0"
        buildConfigField("String", "FANGCUN_BASE_URL", "https://schedule.woxingsf.top/")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("boolean", "DEVELOPER_MODE", "true")
        }
        release {
            buildConfigField("boolean", "DEVELOPER_MODE", "false")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(files("libs/xms-wearable-lib_1.4_release.aar"))
}
