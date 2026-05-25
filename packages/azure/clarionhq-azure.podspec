require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "clarionhq-azure"
  s.module_name  = "ClarionAzure"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/Th4nderG0d/clarion"
  s.license      = package["license"]
  s.author       = { "Clarion" => "hello@clarionhq.dev" }
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/Th4nderG0d/clarion.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{swift,h,m,mm,cpp}"
  s.exclude_files = "ios/**/*.swift.bak"
  # Mark our Obj-C bridge header public so Swift code in this pod can see it
  # (Nitrogen's auto-umbrella otherwise only includes generated .hpp files).
  s.public_header_files = "ios/AzureExceptionCatcher.h"

  s.frameworks = "AVFoundation"

  # Microsoft Cognitive Services Speech SDK (iOS xcframework).
  s.dependency "MicrosoftCognitiveServicesSpeech-iOS", "~> 1.40"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_VERSION" => "5.9",
    "OTHER_SWIFT_FLAGS" => "$(inherited) -DCLARION_AZURE"
  }

  load "nitrogen/generated/ios/ClarionAzure+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "React-Core"
end
