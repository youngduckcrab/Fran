/**
 * 가짜 Gemini. 노드 검증(logic.test.mts)이 도는 동안 서버가 진짜 모델 대신 이걸 부른다.
 *
 *   node tests/fake-gemini.mjs            # http://localhost:8841
 *   GOOGLE_GEMINI_BASE_URL=http://localhost:8841 GEMINI_API_KEY=fake … npm start (서버)
 *
 * 번역은 «원문» 으로 감싸서 돌려준다. 그래야 테스트가 "번역이 돌아왔다" 를 글자로 확인할 수 있다.
 * 자막 몇 줄은 진짜 번역처럼 보이게 정해 둔 답을 쓴다.
 *
 * 통역 음성(Live API)은 받은 소리 한 토막마다 정해 둔 모양의 24kHz 소리를 한 토막 돌려준다.
 * 서버가 무엇을 보냈는지는 GET /__live 로 들여다본다.
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.FAKE_GEMINI_PORT ?? 8841);

/** 자막 번역 중 정해 둔 것. 나머지는 «원문». */
const CAPTIONS = {
  'Hoy fui a la playa': '오늘 바닷가에 갔어',
  '보고 싶어': 'Te extraño',
};

/** 통역 세션이 받은 것. 테스트가 들여다본다. */
const live = { setups: [], chunks: 0, ends: 0 };

function reply(text) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
  };
}

function promptOf(body) {
  const contents = Array.isArray(body.contents) ? body.contents : [];
  return contents
    .flatMap((content) => content.parts ?? [])
    .map((part) => part.text ?? '')
    .join('\n');
}

function answer(body) {
  const schema = body.generationConfig?.responseJsonSchema ?? {};
  const properties = schema.properties ?? {};
  const prompt = promptOf(body);

  // 메시지 번역
  if (properties.translations) {
    const text = /Text:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? '';
    const declared = /Declared language: (\w+)/.exec(prompt)?.[1] ?? 'ko';
    const targets = (/## Target languages\n([^\n]*)/.exec(prompt)?.[1] ?? '')
      .split(',')
      .map((lang) => lang.trim())
      .filter(Boolean);
    return {
      detected_lang: declared,
      translations: targets.map((lang) => ({ lang, text: `«${text}»`, notes: [] })),
    };
  }

  // 자막 번역: "<이름> said:\n<말>"
  if (properties.text && Object.keys(properties).length === 1) {
    const said = /said:\n([\s\S]*)$/.exec(prompt)?.[1]?.trim() ?? '';
    return { text: CAPTIONS[said] ?? `«${said}»` };
  }

  return {};
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/__live') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(live));
    return;
  }
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', () => {
    if (!/:generateContent/.test(request.url ?? '')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }));
      return;
    }
    const body = raw ? JSON.parse(raw) : {};
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply(JSON.stringify(answer(body)))));
  });
});

/** 통역 음성. 받은 소리 100ms 마다 24kHz 소리 100ms(2400 표본)를 돌려준다. */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!/BidiGenerateContent/.test(request.url ?? '')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    let target = 'en';
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.setup) {
        live.setups.push(message.setup);
        target = message.setup.generationConfig?.translationConfig?.targetLanguageCode ?? target;
        ws.send(JSON.stringify({ setupComplete: {} }));
        return;
      }
      const input = message.realtimeInput;
      if (input?.audio) {
        live.chunks += 1;
        // 표본 값에 목표 언어의 첫 글자를 새겨 둔다. 테스트가 "어느 말로 옮겼는지" 를 소리에서 읽는다.
        const samples = new Int16Array(2400).fill(target.charCodeAt(0));
        const data = Buffer.from(samples.buffer).toString('base64');
        ws.send(
          JSON.stringify({
            serverContent: {
              modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data } }] },
            },
          }),
        );
        return;
      }
      if (input?.audioStreamEnd) {
        live.ends += 1;
        ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      }
    });
  });
});

server.listen(PORT, () => console.log(`가짜 Gemini: http://localhost:${PORT}`));
