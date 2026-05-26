package com.clarionhq.audio_tap

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.clarion.audio_tap.ClarionAudioTapOnLoad

class ClarionAudioTapPackage : ReactPackage {
  init {
    ClarionAudioTapOnLoad.initializeNative()
  }

  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = emptyList()

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
