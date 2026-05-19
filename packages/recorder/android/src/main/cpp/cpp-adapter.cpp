#include <jni.h>
#include <fbjni/fbjni.h>
#include "ClarionRecorderOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
  return margelo::nitro::clarion::recorder::initialize(vm);
}
