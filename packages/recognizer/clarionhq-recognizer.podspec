require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "clarionhq-recognizer"
  s.module_name  = "ClarionRecognizer"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/Th4nderG0d/clarion"
  s.license      = package["license"]
  s.author       = { "Clarion" => "hello@clarionhq.dev" }
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/Th4nderG0d/clarion.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{swift,h,m,mm,cpp}"
  s.exclude_files = "ios/**/*.swift.bak"
  # Mark Obj-C bridge header public so Swift in this pod can import it
  # (nitrogen's auto-umbrella otherwise only lists generated .hpp files).
  s.public_header_files = "ios/RecognizerExceptionCatcher.h"

  s.frameworks = "AVFoundation", "Speech"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_VERSION" => "5.9",
    "OTHER_SWIFT_FLAGS" => "$(inherited) -DCLARION_RECOGNIZER"
  }

  load "nitrogen/generated/ios/ClarionRecognizer+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "React-Core"
end
