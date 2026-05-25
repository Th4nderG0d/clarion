#include <jni.h>
#include <fbjni/fbjni.h>
#include "ClarionAzureOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
  return margelo::nitro::clarion::azure::initialize(vm);
}
