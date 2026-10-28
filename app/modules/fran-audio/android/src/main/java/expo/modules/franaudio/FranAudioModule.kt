package expo.modules.franaudio

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 통역 음성에 쓰는 날소리 — 자바스크립트 쪽 이름은 FranAudio.
 *
 * startTap/stopTap: 통화 마이크 소리를 100ms 씩 떼어 onMicChunk 로 보낸다(16kHz 모노 16비트, base64).
 * play/stopPlayback: 옮겨 온 소리를 이어 붙여 튼다.
 */
class FranAudioModule : Module() {
  private val player = VoicePlayer()

  override fun definition() = ModuleDefinition {
    Name("FranAudio")

    Events("onMicChunk")

    /** WebRTC 에 우리 소리 장치가 끼워졌는지. 아니면 떼어 낼 소리가 오지 않는다. */
    Function("isTapReady") {
      MicTap.installed
    }

    Function("startTap") {
      MicTap.start { pcm, level ->
        try {
          sendEvent("onMicChunk", mapOf("pcm" to pcm, "level" to level))
        } catch (error: IllegalArgumentException) {
          // 모듈이 이미 내려간 뒤. 통화가 끝나며 곧 멈춘다.
          Log.w("FranAudio", "소리 토막을 보내지 못함", error)
        }
      }
    }

    Function("stopTap") {
      MicTap.stop()
    }

    Function("play") { pcm: String, rate: Int ->
      player.play(pcm, rate)
    }

    Function("stopPlayback") {
      player.stop()
    }

    OnDestroy {
      MicTap.stop()
      player.stop()
    }
  }
}
