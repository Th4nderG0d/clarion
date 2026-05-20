#include <jni.h>
#include <fbjni/fbjni.h>
#include "ClarionRecognizerOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
  return margelo::nitro::clarion::recognizer::initialize(vm);
}
