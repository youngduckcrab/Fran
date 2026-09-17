import { createContext, useContext } from 'react';
import type { LangCode } from '@fran/shared';

/**
 * 화면 문구의 언어. 대화에 쓰는 언어(LangCode)와는 별개다.
 * 중국어를 공부하더라도 화면까지 중국어로 볼 이유는 없어서 세 가지만 둔다.
 */
export const UI_LANGUAGES = ['ko', 'es', 'en'] as const;
export type UiLang = (typeof UI_LANGUAGES)[number];

export function toUiLang(lang: LangCode | string | undefined): UiLang {
  if (lang === 'ko' || lang === 'es' || lang === 'en') return lang;
  return 'en';
}

const ko = {
  'app.name': 'Fran',
  'login.subtitle': '둘만 쓰는 번역 메신저',
  'login.passcode': '패스코드',
  'login.checking': '확인 중…',
  'login.enter': '들어가기',
  'login.failed': '아이디 또는 패스코드가 올바르지 않습니다.',
  'login.as': '{name} 계정으로 들어갑니다',

  'chat.connecting': '연결 중',
  'chat.reconnecting': '다시 연결하는 중…',
  'chat.typing': '입력 중…',
  'chat.online': '접속 중',
  'chat.offline': '오프라인',
  'chat.glossary': '용어집',
  'chat.settings': '설정',
  'chat.sendTo': '{name}에게 보내기',
  'chat.send': '보내기',
  'chat.disconnected': '서버에 연결하지 못했습니다. 잠시 뒤 다시 연결됩니다.',
  'chat.sendFailed': '메시지를 처리하지 못했습니다.',
  'chat.tooLong': '메시지가 너무 깁니다.',

  'note.placeholder': '이 메시지만: 어떻게 번역할지 (예: amor 로 해줘)',
  'note.hint': '상대에게는 보이지 않습니다. 보내고 나면 지워집니다.',
  'note.button': '이 메시지만 번역 지시',

  'bubble.translating': '번역하는 중…',
  'bubble.retry': '다시 시도',
  'bubble.failed': '번역하지 못했습니다.',
  'bubble.onlyYou': '나에게만 보입니다',
  'bubble.sentAs': '{name} 에게는 이렇게 갔어요',
  'bubble.listen': '소리로 듣기',
  'bubble.stop': '그만 듣기',
  'bubble.noVoice': '이 기기에 {lang} 목소리가 없어요.',

  'actions.title': '메시지 메뉴',
  'actions.explain': '설명',
  'actions.explainHint': '단어와 문법을 뜯어봅니다',
  'actions.copy': '복사',
  'actions.retranslate': '다시 번역',
  'actions.close': '닫기',

  'explain.title': '설명',
  'explain.loading': '읽어보는 중…',
  'explain.points': '짚고 갈 점',
  'explain.replies': '이렇게 답할 수 있어요',

  'settings.title': '설정',
  'settings.myLang': '내가 쓰는 언어',
  'settings.myLangHint': '입력한 문장이 이 언어라고 가정하고 번역합니다.',
  'settings.readLang': '내가 받아볼 언어',
  'settings.readLangHint':
    '맨 위 언어가 크게 표시됩니다. 공부 중인 언어를 추가하면 말풍선을 눌렀을 때 함께 보입니다.',
  'settings.showSource': '원문을 항상 함께 보기',
  'settings.logout': '로그아웃',
  'settings.save': '저장',
  'settings.saving': '저장 중…',
  'settings.needOneLang': '표시 언어를 최소 하나는 골라야 합니다.',

  'glossary.title': '용어집',
  'glossary.hint':
    '애칭·별명·둘만 아는 표현을 여기 적어두면 번역이 매번 그 규칙을 따릅니다. "이렇게는 쓰지 말 것"도 정할 수 있습니다.',
  'glossary.empty': '아직 등록한 표현이 없습니다.',
  'glossary.add': '표현 추가',
  'glossary.term': '표현',
  'glossary.termHint': '내가 쓰는 말 그대로. 예: 애기',
  'glossary.termPlaceholder': '애기',
  'glossary.to': '이렇게 번역해 줘',
  'glossary.toHint': '비워두면 번역하지 않고 원문 그대로 둡니다.',
  'glossary.asIs': '번역하지 않고 그대로',
  'glossary.avoid': '이렇게는 쓰지 마',
  'glossary.avoidHint': '쉼표로 구분. 예: amor, cariño',
  'glossary.note': '메모 (선택)',
  'glossary.notePlaceholder': '연인 사이 애칭',
  'glossary.cancel': '취소',
  'glossary.delete': '삭제',

  'error.noApiKey': '번역 서비스가 설정되지 않았습니다.',
  'error.invalidApiKey': '번역 서비스 키가 올바르지 않습니다.',
  'error.quotaMinute': '잠깐 너무 많이 보냈어요. 조금 뒤 다시 시도해 주세요.',
  'error.quotaDay': '오늘 쓸 수 있는 번역을 다 썼어요. 내일 다시 됩니다.',
  'error.overloaded': '번역 서버가 잠시 붐빕니다. 다시 시도해 주세요.',
  'error.network': '번역 서버에 연결하지 못했습니다.',
  'error.modelNotFound': '번역 모델 설정이 잘못되었습니다.',
  'error.refused': '이 메시지는 번역할 수 없었습니다.',

  'home.chat': '채팅',
  'home.chatEmpty': '아직 주고받은 말이 없어요',
  'home.saved': '저장한 문장',
  'home.vocab': '단어장',
  'home.album': '사진첩',
  'home.unread': '안 읽은 메시지 {count}개',
  'home.back': '홈',
  'home.items': '{count}개',
  'home.photos': '사진 {count}장',

  'composer.more': '더 보내기',
  'composer.photo': '사진 보내기',
  'composer.record': '음성 녹음',
  'composer.recording': '녹음 중 {time}',
  'composer.sendRecording': '멈추고 보내기',
  'composer.cancelRecording': '취소',
  'composer.uploading': '올리는 중…',
  'composer.photoReady': '사진이 준비됐어요',
  'composer.voiceReady': '음성이 준비됐어요 ({time})',
  'composer.removeAttachment': '빼기',
  'composer.micDenied': '마이크를 쓸 수 없어요. 권한을 확인해 주세요.',

  'bubble.photo': '사진',
  'bubble.voice': '음성 메시지',
  'bubble.transcript': '받아쓴 글',
  'bubble.transcribing': '무슨 말인지 듣는 중…',
  'bubble.transcribeFailed': '받아쓰지 못했어요.',

  'actions.save': '이 문장 저장',
  'actions.saveHint': '나중에 모아서 볼 수 있어요',
  'actions.saved': '저장했어요',

  'saved.title': '저장한 문장',
  'saved.empty': '아직 저장한 문장이 없어요. 말풍선을 길게 눌러 저장할 수 있어요.',
  'saved.delete': '지우기',

  'vocab.title': '단어장',
  'vocab.empty': '아직 담은 단어가 없어요. 설명 화면에서 + 를 눌러 담을 수 있어요.',
  'vocab.add': '단어장에 담기',
  'vocab.added': '담았어요',
  'vocab.delete': '지우기',

  'album.title': '사진첩',
  'album.empty': '아직 주고받은 사진이 없어요.',
  'album.setWallpaper': '배경으로',

  'settings.wallpaper': '배경화면',
  'settings.wallpaperHint': '폰에 있는 사진이나 사진첩의 사진도 배경으로 쓸 수 있어요.',
  'settings.wallpaperPick': '갤러리에서 고르기',
  'settings.notify': '알림',
  'settings.notifyOn': '새 메시지 알림 받기',
  'settings.notifyHint': '앱을 닫아 두었을 때 폰으로 알려줘요.',
  'settings.notifyDenied': '브라우저에서 알림이 막혀 있어요. 브라우저 설정에서 허용해 주세요.',
  'settings.notifyUnsupported': '이 브라우저에서는 알림을 쓸 수 없어요. 홈 화면에 추가하면 될 수도 있어요.',
  'settings.notifyFailed': '알림을 켜지 못했어요.',

  'wall.default': '기본',
  'wall.night': '밤',
  'wall.dawn': '새벽',
  'wall.forest': '숲',
  'wall.sand': '모래',
  'wall.rose': '장미',
  'wall.mono': '단색',
  'wall.photo': '사진',

  'chat.reconnectingShort': '연결 중…',

  'error.unknown': '번역하지 못했습니다.',
} as const;

export type StringKey = keyof typeof ko;

const es: Record<StringKey, string> = {
  'app.name': 'Fran',
  'login.subtitle': 'Nuestro mensajero, solo para dos',
  'login.passcode': 'Código',
  'login.checking': 'Comprobando…',
  'login.enter': 'Entrar',
  'login.failed': 'El usuario o el código no son correctos.',
  'login.as': 'Entras como {name}',

  'chat.connecting': 'Conectando',
  'chat.reconnecting': 'Reconectando…',
  'chat.typing': 'Escribiendo…',
  'chat.online': 'En línea',
  'chat.offline': 'Desconectado',
  'chat.glossary': 'Glosario',
  'chat.settings': 'Ajustes',
  'chat.sendTo': 'Escribir a {name}',
  'chat.send': 'Enviar',
  'chat.disconnected': 'No se pudo conectar al servidor. Se reintentará en un momento.',
  'chat.sendFailed': 'No se pudo enviar el mensaje.',
  'chat.tooLong': 'El mensaje es demasiado largo.',

  'note.placeholder': 'Solo este mensaje: cómo traducirlo (ej: usa "amor")',
  'note.hint': 'La otra persona no lo verá. Se borra al enviar.',
  'note.button': 'Instrucción solo para este mensaje',

  'bubble.translating': 'Traduciendo…',
  'bubble.retry': 'Reintentar',
  'bubble.failed': 'No se pudo traducir.',
  'bubble.onlyYou': 'Solo tú lo ves',
  'bubble.sentAs': 'Así lo recibió {name}',
  'bubble.listen': 'Escuchar',
  'bubble.stop': 'Detener',
  'bubble.noVoice': 'Este equipo no tiene una voz en {lang}.',

  'actions.title': 'Opciones del mensaje',
  'actions.explain': 'Explicar',
  'actions.explainHint': 'Palabra por palabra y la gramática',
  'actions.copy': 'Copiar',
  'actions.retranslate': 'Traducir de nuevo',
  'actions.close': 'Cerrar',

  'explain.title': 'Explicación',
  'explain.loading': 'Leyendo…',
  'explain.points': 'Para fijarse',
  'explain.replies': 'Puedes responder así',

  'settings.title': 'Ajustes',
  'settings.myLang': 'El idioma en que escribo',
  'settings.myLangHint': 'Se asume que escribes en este idioma al traducir.',
  'settings.readLang': 'Idiomas que quiero leer',
  'settings.readLangHint':
    'El primero se muestra en grande. Si añades el idioma que estudias, aparece al tocar el mensaje.',
  'settings.showSource': 'Mostrar siempre el original',
  'settings.logout': 'Cerrar sesión',
  'settings.save': 'Guardar',
  'settings.saving': 'Guardando…',
  'settings.needOneLang': 'Elige al menos un idioma.',

  'glossary.title': 'Glosario',
  'glossary.hint':
    'Apunta aquí los apodos y las expresiones que solo ustedes dos usan, y la traducción los respetará siempre. También puedes decir qué palabras no usar.',
  'glossary.empty': 'Todavía no hay nada aquí.',
  'glossary.add': 'Añadir expresión',
  'glossary.term': 'Expresión',
  'glossary.termHint': 'Tal como la dices. Ej: bebé',
  'glossary.termPlaceholder': 'bebé',
  'glossary.to': 'Tradúcelo así',
  'glossary.toHint': 'Si lo dejas vacío, se deja igual sin traducir.',
  'glossary.asIs': 'se deja igual, sin traducir',
  'glossary.avoid': 'No uses estas palabras',
  'glossary.avoidHint': 'Separadas por comas. Ej: amor, cariño',
  'glossary.note': 'Nota (opcional)',
  'glossary.notePlaceholder': 'apodo cariñoso',
  'glossary.cancel': 'Cancelar',
  'glossary.delete': 'Borrar',

  'error.noApiKey': 'El servicio de traducción no está configurado.',
  'error.invalidApiKey': 'La clave del servicio de traducción no es válida.',
  'error.quotaMinute': 'Demasiados mensajes seguidos. Inténtalo en un momento.',
  'error.quotaDay': 'Se acabaron las traducciones de hoy. Mañana vuelve a funcionar.',
  'error.overloaded': 'El servidor de traducción está ocupado. Inténtalo de nuevo.',
  'error.network': 'No se pudo conectar con el servidor de traducción.',
  'error.modelNotFound': 'La configuración del modelo de traducción es incorrecta.',
  'error.refused': 'Este mensaje no se pudo traducir.',
  'error.unknown': 'No se pudo traducir.',

  'home.chat': 'Chat',
  'home.chatEmpty': 'Todavía no hay mensajes',
  'home.saved': 'Frases guardadas',
  'home.vocab': 'Vocabulario',
  'home.album': 'Fotos',
  'home.unread': '{count} mensajes sin leer',
  'home.back': 'Inicio',
  'home.items': '{count}',
  'home.photos': '{count} fotos',

  'composer.more': 'Más',
  'composer.photo': 'Enviar foto',
  'composer.record': 'Grabar voz',
  'composer.recording': 'Grabando {time}',
  'composer.sendRecording': 'Parar y enviar',
  'composer.cancelRecording': 'Cancelar',
  'composer.uploading': 'Subiendo…',
  'composer.photoReady': 'Foto lista',
  'composer.voiceReady': 'Audio listo ({time})',
  'composer.removeAttachment': 'Quitar',
  'composer.micDenied': 'No se puede usar el micrófono. Revisa los permisos.',

  'bubble.photo': 'Foto',
  'bubble.voice': 'Mensaje de voz',
  'bubble.transcript': 'Lo que se dijo',
  'bubble.transcribing': 'Escuchando…',
  'bubble.transcribeFailed': 'No se pudo transcribir.',

  'actions.save': 'Guardar esta frase',
  'actions.saveHint': 'Para repasarla después',
  'actions.saved': 'Guardada',

  'saved.title': 'Frases guardadas',
  'saved.empty': 'Aún no guardaste ninguna frase. Mantén pulsado un mensaje para guardarlo.',
  'saved.delete': 'Borrar',

  'vocab.title': 'Vocabulario',
  'vocab.empty': 'Aún no hay palabras. Pulsa + en la explicación para añadirlas.',
  'vocab.add': 'Añadir al vocabulario',
  'vocab.added': 'Añadida',
  'vocab.delete': 'Borrar',

  'album.title': 'Fotos',
  'album.empty': 'Todavía no hay fotos.',
  'album.setWallpaper': 'De fondo',

  'settings.wallpaper': 'Fondo',
  'settings.wallpaperHint': 'También puedes usar una foto de tu teléfono o del chat.',
  'settings.wallpaperPick': 'Elegir de la galería',
  'settings.notify': 'Avisos',
  'settings.notifyOn': 'Avisarme de mensajes nuevos',
  'settings.notifyHint': 'Te avisa en el teléfono cuando la app está cerrada.',
  'settings.notifyDenied': 'El navegador tiene los avisos bloqueados. Permítelos en los ajustes.',
  'settings.notifyUnsupported': 'Este navegador no puede avisarte. Prueba a añadir la app a la pantalla de inicio.',
  'settings.notifyFailed': 'No se pudieron activar los avisos.',

  'wall.default': 'Normal',
  'wall.night': 'Noche',
  'wall.dawn': 'Amanecer',
  'wall.forest': 'Bosque',
  'wall.sand': 'Arena',
  'wall.rose': 'Rosa',
  'wall.mono': 'Liso',
  'wall.photo': 'Foto',

  'chat.reconnectingShort': 'Conectando…',
};

const en: Record<StringKey, string> = {
  'app.name': 'Fran',
  'login.subtitle': 'A messenger just for the two of us',
  'login.passcode': 'Passcode',
  'login.checking': 'Checking…',
  'login.enter': 'Enter',
  'login.failed': 'That name or passcode is not right.',
  'login.as': 'Signing in as {name}',

  'chat.connecting': 'Connecting',
  'chat.reconnecting': 'Reconnecting…',
  'chat.typing': 'Typing…',
  'chat.online': 'Online',
  'chat.offline': 'Offline',
  'chat.glossary': 'Glossary',
  'chat.settings': 'Settings',
  'chat.sendTo': 'Message {name}',
  'chat.send': 'Send',
  'chat.disconnected': "Couldn't reach the server. Trying again shortly.",
  'chat.sendFailed': "Couldn't send that message.",
  'chat.tooLong': 'That message is too long.',

  'note.placeholder': 'Just this message: how to translate it (e.g. use "amor")',
  'note.hint': "The other person won't see this. It clears after you send.",
  'note.button': 'Instruction for this message only',

  'bubble.translating': 'Translating…',
  'bubble.retry': 'Try again',
  'bubble.failed': "Couldn't translate this.",
  'bubble.onlyYou': 'Only you can see this',
  'bubble.sentAs': 'How {name} received it',
  'bubble.listen': 'Listen',
  'bubble.stop': 'Stop',
  'bubble.noVoice': 'This device has no {lang} voice.',

  'actions.title': 'Message options',
  'actions.explain': 'Explain',
  'actions.explainHint': 'Word by word, and the grammar',
  'actions.copy': 'Copy',
  'actions.retranslate': 'Translate again',
  'actions.close': 'Close',

  'explain.title': 'Explanation',
  'explain.loading': 'Reading it…',
  'explain.points': 'Worth noticing',
  'explain.replies': 'You could reply',

  'settings.title': 'Settings',
  'settings.myLang': 'The language I write in',
  'settings.myLangHint': 'Your messages are assumed to be in this language.',
  'settings.readLang': 'Languages I want to read',
  'settings.readLangHint':
    'The first one shows large. Add a language you are studying and it appears when you tap a message.',
  'settings.showSource': 'Always show the original',
  'settings.logout': 'Log out',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.needOneLang': 'Pick at least one language.',

  'glossary.title': 'Glossary',
  'glossary.hint':
    'Put your pet names and in-jokes here and every translation will follow them. You can also say which words never to use.',
  'glossary.empty': 'Nothing here yet.',
  'glossary.add': 'Add an expression',
  'glossary.term': 'Expression',
  'glossary.termHint': 'Exactly as you say it. e.g. babe',
  'glossary.termPlaceholder': 'babe',
  'glossary.to': 'Translate it like this',
  'glossary.toHint': 'Leave empty to keep it untranslated.',
  'glossary.asIs': 'kept as written, untranslated',
  'glossary.avoid': 'Never use these',
  'glossary.avoidHint': 'Separated by commas. e.g. amor, cariño',
  'glossary.note': 'Note (optional)',
  'glossary.notePlaceholder': 'pet name',
  'glossary.cancel': 'Cancel',
  'glossary.delete': 'Delete',

  'error.noApiKey': 'The translation service is not set up.',
  'error.invalidApiKey': 'The translation service key is not valid.',
  'error.quotaMinute': 'Too many messages at once. Try again in a moment.',
  'error.quotaDay': "Today's translations are used up. It works again tomorrow.",
  'error.overloaded': 'The translation server is busy. Try again.',
  'error.network': "Couldn't reach the translation server.",
  'error.modelNotFound': 'The translation model setting is wrong.',
  'error.refused': "This message couldn't be translated.",
  'error.unknown': "Couldn't translate this.",

  'home.chat': 'Chat',
  'home.chatEmpty': 'No messages yet',
  'home.saved': 'Saved sentences',
  'home.vocab': 'Vocabulary',
  'home.album': 'Photos',
  'home.unread': '{count} unread',
  'home.back': 'Home',
  'home.items': '{count}',
  'home.photos': '{count} photos',

  'composer.more': 'More',
  'composer.photo': 'Send a photo',
  'composer.record': 'Record voice',
  'composer.recording': 'Recording {time}',
  'composer.sendRecording': 'Stop and send',
  'composer.cancelRecording': 'Cancel',
  'composer.uploading': 'Uploading…',
  'composer.photoReady': 'Photo ready',
  'composer.voiceReady': 'Audio ready ({time})',
  'composer.removeAttachment': 'Remove',
  'composer.micDenied': "Can't use the microphone. Check permissions.",

  'bubble.photo': 'Photo',
  'bubble.voice': 'Voice message',
  'bubble.transcript': 'What was said',
  'bubble.transcribing': 'Listening…',
  'bubble.transcribeFailed': "Couldn't transcribe this.",

  'actions.save': 'Save this sentence',
  'actions.saveHint': 'To go over it later',
  'actions.saved': 'Saved',

  'saved.title': 'Saved sentences',
  'saved.empty': 'Nothing saved yet. Press and hold a message to save it.',
  'saved.delete': 'Delete',

  'vocab.title': 'Vocabulary',
  'vocab.empty': 'No words yet. Tap + in an explanation to add one.',
  'vocab.add': 'Add to vocabulary',
  'vocab.added': 'Added',
  'vocab.delete': 'Delete',

  'album.title': 'Photos',
  'album.empty': 'No photos yet.',
  'album.setWallpaper': 'Use as background',

  'settings.wallpaper': 'Background',
  'settings.wallpaperHint': 'You can also use a photo from your phone or the chat.',
  'settings.wallpaperPick': 'Choose from gallery',
  'settings.notify': 'Notifications',
  'settings.notifyOn': 'Notify me of new messages',
  'settings.notifyHint': 'Your phone tells you when the app is closed.',
  'settings.notifyDenied': 'Notifications are blocked in this browser. Allow them in its settings.',
  'settings.notifyUnsupported': "This browser can't notify you. Adding the app to your home screen may help.",
  'settings.notifyFailed': "Couldn't turn notifications on.",

  'wall.default': 'Default',
  'wall.night': 'Night',
  'wall.dawn': 'Dawn',
  'wall.forest': 'Forest',
  'wall.sand': 'Sand',
  'wall.rose': 'Rose',
  'wall.mono': 'Mono',
  'wall.photo': 'Photo',

  'chat.reconnectingShort': 'Connecting…',
};

const STRINGS: Record<UiLang, Record<StringKey, string>> = { ko, es, en };

export type Translate = (key: StringKey, vars?: Record<string, string>) => string;

export function createTranslate(lang: UiLang): Translate {
  const table = STRINGS[lang];
  return (key, vars) => {
    let text: string = table[key] ?? STRINGS.en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, value);
      }
    }
    return text;
  };
}

/** 로그인 전에는 사용자를 모르므로 브라우저 설정을 본다. */
export function browserUiLang(): UiLang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.slice(0, 2).toLowerCase();
    if (base === 'ko' || base === 'es' || base === 'en') return base;
  }
  return 'en';
}

export const TranslateContext = createContext<Translate>(createTranslate('ko'));
export const useT = (): Translate => useContext(TranslateContext);
