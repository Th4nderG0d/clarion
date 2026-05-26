#include <jni.h>
#include <fbjni/fbjni.h>
#include "ClarionAudioTapOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
  return margelo::nitro::clarion::audio_tap::initialize(vm);
}
