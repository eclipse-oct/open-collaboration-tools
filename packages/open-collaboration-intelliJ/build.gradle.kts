plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "1.9.25"
  id("org.jetbrains.intellij") version "1.17.4"
}

dependencies {
  implementation("org.eclipse.lsp4j:org.eclipse.lsp4j.jsonrpc:0.24.0")
  implementation("org.msgpack:jackson-dataformat-msgpack:0.9.9")
  implementation("org.msgpack:msgpack-core:0.9.9")

}

group = "org.typefox"
version = "1.0-SNAPSHOT"

repositories {
  mavenCentral()
}

// Configure Gradle IntelliJ Plugin
// Read more: https://plugins.jetbrains.com/docs/intellij/tools-gradle-intellij-plugin.html
intellij {
  version.set("2023.2.6")
  type.set("IC") // Target IDE Platform

  plugins.set(listOf(/* Plugin Dependencies */))
}

tasks {
  // Set the JVM compatibility versions
  withType<JavaCompile> {
    sourceCompatibility = "17"
    targetCompatibility = "17"
  }
  withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
    kotlinOptions.jvmTarget = "17"
  }

  patchPluginXml {
    sinceBuild.set("232")
    untilBuild.set("242.*")
  }

  signPlugin {
    certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
    privateKey.set(System.getenv("PRIVATE_KEY"))
    password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
  }

  publishPlugin {
    token.set(System.getenv("PUBLISH_TOKEN"))
  }

  prepareSandbox {
      from("../../packages/open-collaboration-service-process/bin/oct-service-process.exe") {
        into("${intellij.pluginName.get()}/lib")
      }
  }
}

tasks.register<Exec>("createExecutable") {
  workingDir = file("../../packages/open-collaboration-service-process")
  commandLine("npm", "run", "create:executable")
}
