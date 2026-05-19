package com.clarionhq.recorder

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.clarion.recorder.ClarionRecorderOnLoad

/**
 * Stub ReactPackage so React Native's autolinker discovers this library.
 * Nitro registers the actual HybridObject via JNI inside the C++ library — this
 * class triggers the System.loadLibrary call (idempotent) at startup so the
 * registration runs before any JS code calls `createHybridObject('ClarionRecorder')`.
 */
class ClarionRecorderPackage : ReactPackage {
  init {
    ClarionRecorderOnLoad.initializeNative()
  }

  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = emptyList()

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
