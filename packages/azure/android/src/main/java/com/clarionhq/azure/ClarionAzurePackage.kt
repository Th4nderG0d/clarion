package com.clarionhq.azure

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.clarion.azure.ClarionAzureOnLoad

/**
 * Stub ReactPackage so React Native's autolinker discovers this library.
 * Nitro registers the actual HybridObject via JNI inside the C++ library — this
 * class triggers System.loadLibrary at startup so registration runs before any
 * JS code calls `createHybridObject('ClarionAzure')`.
 */
class ClarionAzurePackage : ReactPackage {
  init {
    ClarionAzureOnLoad.initializeNative()
  }

  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = emptyList()

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
