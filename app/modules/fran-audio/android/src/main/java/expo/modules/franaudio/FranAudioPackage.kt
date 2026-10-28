package expo.modules.franaudio

import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** 앱이 켜질 때 WebRTC 가 쓸 소리 장치를 끼워 넣는다(MicTap.installer). */
class FranAudioPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> {
    return listOf(MicTap.installer)
  }
}
